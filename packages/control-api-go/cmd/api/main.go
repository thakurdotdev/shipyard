package main

import (
	"context"
	"fmt"
	"os"

	"github.com/joho/godotenv"
	"github.com/thakurdotdev/control-api/internal/config"
	"github.com/thakurdotdev/control-api/internal/db"
	"github.com/thakurdotdev/control-api/internal/server"
)

func main() {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		// Try parent directories
		for _, path := range []string{".env", "../.env", "../../.env"} {
			if _, statErr := os.Stat(path); statErr == nil {
				godotenv.Load(path)
				fmt.Printf("📄 Loaded env from %s\n", path)
				break
			}
		}
	} else {
		fmt.Println("📄 Loaded .env file")
	}

	// Load and validate config
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		fmt.Printf("❌ Config error: %v\n", err)
		os.Exit(1)
	}

	// Connect to database
	ctx := context.Background()
	pool, err := db.Connect(ctx)
	if err != nil {
		fmt.Printf("❌ Database error: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	// Create and start server
	srv := server.New(pool)
	srv.StartWithGracefulShutdown()
}
