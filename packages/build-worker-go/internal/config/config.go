package config

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

type Config struct {
	Port            int
	ControlAPIURL   string
	DeployEngineURL string
	GitHubAppID     string
	GitHubKeyPath   string
	WorkspaceDir    string
	BuildWorkers    int
	BunPath         string
}

var cfg *Config

func Load() *Config {
	if cfg != nil {
		return cfg
	}

	cfg = &Config{
		Port:            getEnvInt("PORT", 4001),
		ControlAPIURL:   getEnv("CONTROL_API_URL", "http://localhost:4000"),
		DeployEngineURL: getEnv("DEPLOY_ENGINE_URL", "http://localhost:4002"),
		GitHubAppID:     getEnv("GITHUB_APP_ID", ""),
		GitHubKeyPath:   getEnv("GITHUB_APP_PRIVATE_KEY_PATH", ""),
		WorkspaceDir:    getEnv("WORKSPACE_DIR", "./workspace"),
		BuildWorkers:    getEnvInt("BUILD_WORKERS", 3),
		BunPath:         findBunPath(),
	}

	return cfg
}

func Get() *Config {
	if cfg == nil {
		return Load()
	}
	return cfg
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return fallback
}

func findBunPath() string {
	// 1. Check environment variable
	if path := os.Getenv("BUN_PATH"); path != "" {
		return path
	}

	// 2. Check PATH
	if path, err := exec.LookPath("bun"); err == nil {
		return path
	}

	// 3. Common locations
	commonPaths := []string{
		"bun",
		"/root/.bun/bin/bun",
		"/home/ubuntu/.bun/bin/bun",
		"/home/deploy/.bun/bin/bun",
		"/usr/local/bin/bun",
		"/opt/bun/bin/bun",
	}

	// Try home dir for current user
	if home, err := os.UserHomeDir(); err == nil {
		commonPaths = append(commonPaths, filepath.Join(home, ".bun", "bin", "bun"))
	}

	for _, p := range commonPaths {
		if p == "bun" {
			if path, err := exec.LookPath("bun"); err == nil {
				return path
			}
			continue
		}
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	// 4. Scan /home for any user with bun
	if entries, err := os.ReadDir("/home"); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				path := filepath.Join("/home", entry.Name(), ".bun", "bin", "bun")
				if _, err := os.Stat(path); err == nil {
					return path
				}
			}
		}
	}

	return "bun"
}
