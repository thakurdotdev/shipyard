package main

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
	"github.com/thakurdotdev/build-worker/internal/config"
	"github.com/thakurdotdev/build-worker/internal/server"
)

func main() {
	// Load .env file if exists
	if err := godotenv.Load(); err != nil {
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

	config.Load()
	srv := server.New()
	srv.StartWithGracefulShutdown()
}
