package main

import (
	"github.com/thakurdotdev/deploy-engine/internal/config"
	"github.com/thakurdotdev/deploy-engine/internal/server"
)

func main() {
	// Load configuration
	config.Load()

	// Create and start server
	srv := server.New()
	srv.StartWithGracefulShutdown()
}
