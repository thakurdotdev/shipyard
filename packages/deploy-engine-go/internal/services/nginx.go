package services

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/thakurdotdev/deploy-engine/internal/config"
)

const (
	nginxAvailableDir = "/etc/nginx/platform-sites"
	nginxEnabledDir   = "/etc/nginx/platform-sites"
)

var reservedSubdomains = map[string]bool{
	"www": true, "api": true, "admin": true, "dashboard": true,
	"deploy": true, "git": true, "db": true, "mail": true,
	"staging": true, "dev": true,
}

type NginxService struct {
	baseDomain string
}

func NewNginxService() *NginxService {
	return &NginxService{
		baseDomain: config.Get().BaseDomain,
	}
}

func (n *NginxService) IsSubdomainAllowed(sub string) bool {
	if sub == "" {
		return false
	}
	s := strings.ToLower(strings.TrimSpace(sub))
	if reservedSubdomains[s] {
		return false
	}
	matched, _ := regexp.MatchString(`^[a-z0-9-]+$`, s)
	if !matched {
		return false
	}
	if strings.HasPrefix(s, "-") || strings.HasSuffix(s, "-") {
		return false
	}
	return true
}

func (n *NginxService) GenerateConfig(sub string, port int) string {
	return fmt.Sprintf(`
server {
    listen 80;
    server_name %s.%s;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name %s.%s;

    ssl_certificate     /etc/letsencrypt/live/%s/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/%s/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://localhost:%d;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
`, sub, n.baseDomain, sub, n.baseDomain, n.baseDomain, n.baseDomain, port)
}

func (n *NginxService) CreateConfig(sub string, port int) error {
	if !n.IsSubdomainAllowed(sub) {
		return fmt.Errorf("invalid or reserved subdomain: %s", sub)
	}

	available := filepath.Join(nginxAvailableDir, sub+".conf")
	enabled := filepath.Join(nginxEnabledDir, sub+".conf")

	if err := os.WriteFile(available, []byte(n.GenerateConfig(sub, port)), 0644); err != nil {
		return fmt.Errorf("failed to write nginx config: %w", err)
	}

	if _, err := os.Stat(enabled); os.IsNotExist(err) {
		if err := os.Symlink(available, enabled); err != nil {
			return fmt.Errorf("failed to create symlink: %w", err)
		}
	}

	return n.Reload()
}

func (n *NginxService) RemoveConfig(sub string) error {
	available := filepath.Join(nginxAvailableDir, sub+".conf")
	enabled := filepath.Join(nginxEnabledDir, sub+".conf")

	os.Remove(enabled)
	os.Remove(available)

	return n.Reload()
}

func (n *NginxService) CreateDefaultConfig() error {
	content := fmt.Sprintf(`
server {
    listen 80;
    server_name _ *.%s;
    add_header Content-Type text/plain;
    return 404 "Unknown subdomain. No project deployed.\n";
}

server {
    listen 443 ssl;
    server_name _ *.%s;

    ssl_certificate     /etc/letsencrypt/live/%s/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/%s/privkey.pem;

    add_header Content-Type text/plain;
    return 404 "Unknown subdomain. No project deployed.\n";
}
`, n.baseDomain, n.baseDomain, n.baseDomain, n.baseDomain)

	file := filepath.Join(nginxAvailableDir, "00-default.conf")
	if err := os.WriteFile(file, []byte(content), 0644); err != nil {
		return err
	}

	return n.Reload()
}

func (n *NginxService) Reload() error {
	return retry(3, func() error {
		// Test config first
		testCmd := exec.Command("sudo", "nginx", "-t")
		if out, err := testCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("nginx config validation failed: %s", string(out))
		}

		// Reload nginx
		reloadCmd := exec.Command("sudo", "systemctl", "reload", "nginx")
		if out, err := reloadCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("nginx reload failed: %s", string(out))
		}

		return nil
	})
}

func retry(attempts int, fn func() error) error {
	var err error
	for i := 0; i < attempts; i++ {
		if err = fn(); err == nil {
			return nil
		}
	}
	return err
}
