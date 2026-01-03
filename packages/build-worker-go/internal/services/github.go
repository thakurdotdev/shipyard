package services

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/thakurdotdev/build-worker/internal/config"
)

// GitHubService handles GitHub App authentication
type GitHubService struct {
	appID      string
	privateKey *rsa.PrivateKey
}

var defaultGitHubService *GitHubService

// GetGitHubService returns the singleton
func GetGitHubService() (*GitHubService, error) {
	if defaultGitHubService != nil {
		return defaultGitHubService, nil
	}

	cfg := config.Get()
	if cfg.GitHubAppID == "" {
		return nil, fmt.Errorf("GITHUB_APP_ID not set")
	}

	key, err := loadPrivateKey(cfg.GitHubKeyPath)
	if err != nil {
		return nil, err
	}

	defaultGitHubService = &GitHubService{
		appID:      cfg.GitHubAppID,
		privateKey: key,
	}
	return defaultGitHubService, nil
}

// loadPrivateKey reads and parses the PEM file
func loadPrivateKey(path string) (*rsa.PrivateKey, error) {
	// If path specified, use it directly
	if path != "" {
		return parseKeyFile(path)
	}

	// Search common locations
	commonPaths := []string{
		"github-app.pem",           // Current directory
		"../github-app.pem",        // Parent
		"../../github-app.pem",     // Grandparent (monorepo root)
		"/etc/thakur/github-app.pem", // System config
	}

	// Try project root based on working directory
	if cwd, err := os.Getwd(); err == nil {
		// If we're in packages/build-worker-go, go up to project root
		candidates := []string{
			filepath.Join(cwd, "github-app.pem"),
			filepath.Join(cwd, "..", "..", "github-app.pem"),
			filepath.Join(cwd, "..", "..", "..", "github-app.pem"),
		}
		commonPaths = append(candidates, commonPaths...)
	}

	// Try home directory
	if home, err := os.UserHomeDir(); err == nil {
		commonPaths = append(commonPaths,
			filepath.Join(home, "github-app.pem"),
			filepath.Join(home, ".config", "thakur", "github-app.pem"),
		)
	}

	// Find the first existing file
	for _, p := range commonPaths {
		if _, err := os.Stat(p); err == nil {
			fmt.Printf("[GitHub] Found private key at: %s\n", p)
			return parseKeyFile(p)
		}
	}

	return nil, fmt.Errorf("GitHub App private key not found. Set GITHUB_APP_PRIVATE_KEY_PATH or place github-app.pem in project root")
}

func parseKeyFile(path string) (*rsa.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block")
	}

	// Try PKCS#1 first
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}

	// Try PKCS#8
	keyInterface, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	rsaKey, ok := keyInterface.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("key is not RSA")
	}

	return rsaKey, nil
}

// GenerateAppJWT creates a JWT for GitHub App auth
func (g *GitHubService) GenerateAppJWT() (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iat": now.Add(-60 * time.Second).Unix(),
		"exp": now.Add(10 * time.Minute).Unix(),
		"iss": g.appID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(g.privateKey)
}

// GetInstallationToken exchanges JWT for installation access token
func (g *GitHubService) GetInstallationToken(installationID string) (string, error) {
	if installationID == "" {
		return "", fmt.Errorf("installation ID required")
	}

	appJWT, err := g.GenerateAppJWT()
	if err != nil {
		return "", fmt.Errorf("failed to generate JWT: %w", err)
	}

	url := fmt.Sprintf("https://api.github.com/app/installations/%s/access_tokens", installationID)
	req, _ := http.NewRequest("POST", url, nil)
	req.Header.Set("Authorization", "Bearer "+appJWT)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("GitHub API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	var result struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	return result.Token, nil
}
