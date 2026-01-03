package server

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/thakurdotdev/build-worker/internal/services"
)

// RegisterRoutes sets up the API routes
func RegisterRoutes(r chi.Router) {
	r.Get("/", handleIndex)
	r.Get("/health", handleHealth)
	r.Post("/build", handleBuild)
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte("Build Worker is running"))
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{
		"status":    "healthy",
		"timestamp": fmt.Sprintf("%v", r.Context().Value("timestamp")),
	})
}

func handleBuild(w http.ResponseWriter, r *http.Request) {
	var job services.BuildJob
	if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if job.BuildID == "" || job.ProjectID == "" || job.GithubURL == "" {
		http.Error(w, "Missing required fields: build_id, project_id, github_url", http.StatusBadRequest)
		return
	}

	// Set defaults
	if job.BuildCommand == "" {
		job.BuildCommand = "bun run build"
	}
	if job.RootDirectory == "" {
		job.RootDirectory = "."
	}
	if job.AppType == "" {
		job.AppType = "vite"
	}

	fmt.Printf("[Build] Received request for %s\n", job.BuildID)

	// Submit to worker pool (async)
	services.GetBuilderPool().Submit(job)

	writeJSON(w, map[string]interface{}{
		"success":  true,
		"message":  "Build started",
		"build_id": job.BuildID,
	})
}

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}
