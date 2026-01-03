package config

import (
	"os"
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
