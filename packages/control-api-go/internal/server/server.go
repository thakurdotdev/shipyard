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
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/config"
	"github.com/thakurdotdev/control-api/internal/handlers"
	mw "github.com/thakurdotdev/control-api/internal/middleware"
)

type Server struct {
	router *chi.Mux
	http   *http.Server
	logger *slog.Logger
	pool   *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Server {
	cfg := config.Get()
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(corsMiddleware(cfg.ClientURL))

	srv := &Server{
		router: r,
		logger: logger,
		pool:   pool,
		http: &http.Server{
			Addr:         fmt.Sprintf(":%d", cfg.Port),
			Handler:      r,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 120 * time.Second,
			IdleTimeout:  60 * time.Second,
		},
	}

	// Register routes
	srv.registerRoutes()

	return srv
}

func (s *Server) registerRoutes() {
	// Create handlers
	projectHandler := handlers.NewProjectHandler(s.pool)
	buildHandler := handlers.NewBuildHandler(s.pool)
	deploymentHandler := handlers.NewDeploymentHandler(s.pool)
	githubHandler, _ := handlers.NewGitHubHandler(s.pool)
	authHandler := handlers.NewAuthHandler(s.pool)

	// Health check (no auth)
	s.router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy"}`))
	})

	// Root (no auth)
	s.router.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Control API (Go)"))
	})

	// Auth routes (no auth required - handles login)
	s.router.Mount("/auth", authHandler.Routes())

	// GitHub - mixed auth (webhook no auth, API routes with auth)
	if githubHandler != nil {
		s.router.Route("/github", func(r chi.Router) {
			// Webhook (NO AUTH)
			r.Post("/webhook", githubHandler.HandleWebhook)

			// Protected routes (need auth)
			r.Group(func(r chi.Router) {
				r.Use(mw.AuthMiddleware(s.pool))
				r.Get("/installations", githubHandler.ListInstallations)
				r.Get("/installations/{id}/repositories", githubHandler.ListRepos)
				r.Get("/installations/{id}/repositories/{owner}/{repo}/folders", githubHandler.ListFolders)
			})
		})
	}

	// Builds - mixed auth (some internal, some protected)
	s.router.Route("/builds", func(r chi.Router) {
		// Internal routes (NO AUTH - build-worker/deploy-engine calls these)
		r.Put("/{id}", buildHandler.UpdateStatus)
		r.Post("/{id}/logs", buildHandler.AppendLog)

		// Protected routes (need auth)
		r.Group(func(r chi.Router) {
			r.Use(mw.AuthMiddleware(s.pool))
			r.Get("/{id}", buildHandler.Get)
			r.Get("/{id}/logs", buildHandler.GetLogs)
			r.Delete("/{id}/logs", buildHandler.ClearLogs)
			r.Get("/{id}/stream", buildHandler.StreamLogs)
		})
	})

	// Protected routes (require auth)
	s.router.Group(func(r chi.Router) {
		r.Use(mw.AuthMiddleware(s.pool))

		// Project routes (includes nested routes)
		r.Mount("/projects", projectHandler.Routes())
		
		// Deploy routes
		r.Post("/deploy/build/{id}/activate", deploymentHandler.ActivateBuild)
	})
}

func (s *Server) Start() error {
	cfg := config.Get()
	s.logger.Info("Control API starting",
		"port", cfg.Port,
		"db_pool_max", cfg.DBMaxConns,
	)
	fmt.Printf("🚀 Control API (Go) running at http://localhost:%d\n", cfg.Port)
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

func corsMiddleware(clientURL string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", clientURL)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Credentials", "true")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
