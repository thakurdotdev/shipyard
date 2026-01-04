package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port              int
	DatabaseURL       string
	ClientURL         string
	APIURL            string
	JWTSecret         string
	EncryptionKey     string
	GitHubAppID       string
	GitHubKeyPath     string
	BuildWorkerURL    string
	DeployEngineURL   string
	CloudflareAPIKey  string
	CloudflareZoneID  string
	GitHubClientID    string
	GitHubClientSecret string

	// Database pool settings
	DBMaxConns        int
	DBMinConns        int
	DBMaxConnLifetime time.Duration
	DBMaxConnIdleTime time.Duration
}

var cfg *Config

func Load() *Config {
	if cfg != nil {
		return cfg
	}

	cfg = &Config{
		Port:              getEnvInt("PORT", 4000),
		DatabaseURL:       getEnv("DATABASE_URL", ""),
		ClientURL:         getEnv("CLIENT_URL", "http://localhost:3000"),
		APIURL:            getEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000"), // Default to port 4000
		JWTSecret:         getEnv("JWT_SECRET", ""),
		EncryptionKey:     getEnv("ENCRYPTION_KEY", ""),
		GitHubAppID:       getEnv("GITHUB_APP_ID", ""),
		GitHubKeyPath:     getEnv("GITHUB_APP_PRIVATE_KEY_PATH", ""),
		BuildWorkerURL:    getEnv("BUILD_WORKER_URL", "http://localhost:4001"),
		DeployEngineURL:   getEnv("DEPLOY_ENGINE_URL", "http://localhost:4002"),
		CloudflareAPIKey:  getEnv("CLOUDFLARE_API_KEY", ""),
		CloudflareZoneID:  getEnv("CLOUDFLARE_ZONE_ID", ""),
		GitHubClientID:    getEnv("GITHUB_CLIENT_ID", ""),
		GitHubClientSecret: getEnv("GITHUB_CLIENT_SECRET", ""),

		// pgxpool optimized settings
		DBMaxConns:        getEnvInt("DB_MAX_CONNS", 25),
		DBMinConns:        getEnvInt("DB_MIN_CONNS", 5),
		DBMaxConnLifetime: time.Duration(getEnvInt("DB_MAX_CONN_LIFETIME_MIN", 60)) * time.Minute,
		DBMaxConnIdleTime: time.Duration(getEnvInt("DB_MAX_CONN_IDLE_MIN", 30)) * time.Minute,
	}

	return cfg
}

func Get() *Config {
	if cfg == nil {
		return Load()
	}
	return cfg
}

func (c *Config) Validate() error {
	if c.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	if c.JWTSecret == "" {
		return fmt.Errorf("JWT_SECRET is required")
	}
	if c.EncryptionKey == "" {
		return fmt.Errorf("ENCRYPTION_KEY is required")
	}
	return nil
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
