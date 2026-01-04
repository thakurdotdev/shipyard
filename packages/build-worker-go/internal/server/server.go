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
	"github.com/thakurdotdev/build-worker/internal/config"
	"github.com/thakurdotdev/build-worker/internal/services"
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

	// Routes
	RegisterRoutes(r)

	return &Server{
		router: r,
		logger: logger,
		http: &http.Server{
			Addr:         fmt.Sprintf(":%d", cfg.Port),
			Handler:      r,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 600 * time.Second, // Long timeout for builds
			IdleTimeout:  60 * time.Second,
		},
	}
}

func (s *Server) Start() error {
	cfg := config.Get()

	// Initialize worker pool
	services.GetBuilderPool()

	s.logger.Info("Build Worker starting",
		"port", cfg.Port,
		"workers", cfg.BuildWorkers,
		"bunPath", cfg.BunPath,
	)
	fmt.Printf("👷 Build Worker is running at localhost:%d\n", cfg.Port)
	fmt.Printf("🔧 Worker pool size: %d\n", cfg.BuildWorkers)
	fmt.Printf("🍞 Bun path: %s\n", cfg.BunPath)

	return s.http.ListenAndServe()
}

func (s *Server) StartWithGracefulShutdown() {
	go func() {
		if err := s.Start(); err != nil && err != http.ErrServerClosed {
			s.logger.Error("Server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	s.logger.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := s.http.Shutdown(ctx); err != nil {
		s.logger.Error("Forced shutdown", "error", err)
	}

	s.logger.Info("Server stopped")
}
