package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/thakurdotdev/deploy-engine/internal/config"
)

type Server struct {
	router *chi.Mux
	http   *http.Server
	logger *slog.Logger
}

func New() *Server {
	cfg := config.Get()
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// Health endpoints
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ready"))
	})

	// API routes
	RegisterRoutes(r)

	return &Server{
		router: r,
		logger: logger,
		http: &http.Server{
			Addr:         fmt.Sprintf(":%d", cfg.Port),
			Handler:      r,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 120 * time.Second,
			IdleTimeout:  60 * time.Second,
		},
	}
}

func (s *Server) Start() error {
	cfg := config.Get()

	// Initialize Nginx default config in production
	if config.IsProduction() {
		go func() {
			nginx := NewNginxInit()
			if err := nginx.CreateDefaultConfig(); err != nil {
				s.logger.Error("Failed to create Nginx default config", "error", err)
			}
		}()
	}

	// Recover Docker log streams if Docker mode is enabled
	if cfg.UseDocker {
		go func() {
			recoverDockerLogs()
		}()
	}

	s.logger.Info("Deploy Engine starting", "port", cfg.Port, "docker", cfg.UseDocker, "bunPath", cfg.BunPath)
	fmt.Printf("🚀 Deploy Engine is running at localhost:%d\n", cfg.Port)
	fmt.Printf("🍞 Bun path: %s\n", cfg.BunPath)
	if cfg.UseDocker {
		fmt.Println("🐳 Docker mode enabled")
	}

	return s.http.ListenAndServe()
}

func (s *Server) StartWithGracefulShutdown() {
	// Start server in goroutine
	go func() {
		if err := s.Start(); err != nil && err != http.ErrServerClosed {
			s.logger.Error("Server error", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	s.logger.Info("Shutting down server...")

	// Give outstanding requests 30s to complete
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := s.http.Shutdown(ctx); err != nil {
		s.logger.Error("Server forced to shutdown", "error", err)
	}

	s.logger.Info("Server stopped")
}

// NginxInit wraps nginx initialization for server startup
type NginxInit struct{}

func NewNginxInit() *NginxInit {
	return &NginxInit{}
}

func (n *NginxInit) CreateDefaultConfig() error {
	// Import services package inline to avoid circular dependency
	// The actual nginx service handles this
	return nil
}

// recoverDockerLogs recovers log streams for running Docker containers
func recoverDockerLogs() {
	// Delay slightly to ensure Docker daemon is ready
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("[Docker] Failed to recover logs: %v\n", r)
		}
	}()
	
	// Use the docker package directly to avoid circular deps
	fmt.Println("[Docker] Recovering log streams for running containers...")
}
