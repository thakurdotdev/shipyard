package server

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/thakurdotdev/deploy-engine/internal/config"
	"github.com/thakurdotdev/deploy-engine/internal/services"
	"github.com/thakurdotdev/deploy-engine/internal/utils"
)

func RegisterRoutes(r chi.Router) {
	deploy := services.GetDeployService()

	r.Post("/ports/check", handlePortCheck)
	r.Post("/artifacts/upload", handleArtifactUpload(deploy))
	r.Post("/activate", handleActivate(deploy))
	r.Post("/stop", handleStop(deploy))
	r.Post("/projects/{id}/delete", handleDeleteProject(deploy))
	r.Get("/*", handleCatchAll)
}

func handlePortCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Port int `json:"port"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.Port == 0 {
		http.Error(w, "Port required", http.StatusBadRequest)
		return
	}

	available := utils.IsPortAvailable(req.Port)
	writeJSON(w, map[string]bool{"available": available})
}

func handleArtifactUpload(deploy *services.DeployService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		buildID := r.URL.Query().Get("buildId")
		if buildID == "" {
			http.Error(w, "Missing buildId", http.StatusBadRequest)
			return
		}

		artifactPath, err := deploy.ReceiveArtifact(buildID, r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]string{
			"message":      "Artifact received",
			"artifactPath": artifactPath,
		})
	}
}

func handleActivate(deploy *services.DeployService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req services.ActivateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if !config.IsValidAppType(string(req.AppType)) {
			http.Error(w, "Invalid appType", http.StatusBadRequest)
			return
		}

		if err := deploy.ActivateDeployment(req); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]bool{"success": true})
	}
}

func handleStop(deploy *services.DeployService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Port      int    `json:"port"`
			ProjectID string `json:"projectId"`
			BuildID   string `json:"buildId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := deploy.StopDeployment(req.Port, req.ProjectID, req.BuildID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]bool{"success": true})
	}
}

func handleDeleteProject(deploy *services.DeployService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		projectID := chi.URLParam(r, "id")
		if projectID == "" {
			http.Error(w, "Missing project ID", http.StatusBadRequest)
			return
		}

		var req struct {
			Port      int      `json:"port"`
			Subdomain string   `json:"subdomain"`
			BuildIDs  []string `json:"buildIds"`
		}

		// Body is optional for delete
		json.NewDecoder(r.Body).Decode(&req)

		if err := deploy.DeleteProject(projectID, req.Port, req.Subdomain, req.BuildIDs); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]bool{"success": true})
	}
}

func handleCatchAll(w http.ResponseWriter, r *http.Request) {
	// Placeholder for future static serving or health check
	w.Header().Set("Content-Type", "text/plain")
	io.WriteString(w, "Deploy Engine is running")
}

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}
