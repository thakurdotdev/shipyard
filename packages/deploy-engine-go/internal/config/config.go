package config

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

type Config struct {
	Port          int
	ControlAPIURL string
	BaseDomain    string
	ArtifactsDir  string
	AppsDir       string
	NodeEnv       string
	UseDocker     bool
	BunPath       string
}

var cfg *Config

func Load() *Config {
	if cfg != nil {
		return cfg
	}

	cfg = &Config{
		Port:          getEnvInt("PORT", 4002),
		ControlAPIURL: getEnv("CONTROL_API_URL", "http://localhost:4000"),
		BaseDomain:    getEnv("BASE_DOMAIN", "thakur.dev"),
		ArtifactsDir:  getEnv("ARTIFACTS_DIR", "/tmp/deploy-artifacts"),
		AppsDir:       getEnv("APPS_DIR", "./apps"),
		NodeEnv:       getEnv("NODE_ENV", "development"),
		UseDocker:     getEnv("USE_DOCKER", "false") == "true",
		BunPath:       findBunPath(),
	}

	return cfg
}

func Get() *Config {
	if cfg == nil {
		return Load()
	}
	return cfg
}

func IsProduction() bool {
	return Get().NodeEnv == "production"
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
		"bun", // PATH lookup
		"/root/.bun/bin/bun",
		"/home/ubuntu/.bun/bin/bun",
		"/home/deploy/.bun/bin/bun", // Common deployment user
		"/usr/local/bin/bun",
		"/opt/bun/bin/bun",
	}

	// Try to find home dir for current user
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

	// 4. Fallback: Scan /home for any user with bun
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

	return "bun" // Fallback to "bun" hoping it works
}
