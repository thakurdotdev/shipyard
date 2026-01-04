package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// ListBuilds returns all builds for a project
func (h *ProjectHandler) ListBuilds(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	builds, err := h.buildService.ListBuildsByProject(r.Context(), projectID, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, builds)
}

// CreateBuild creates a new build for a project
func (h *ProjectHandler) CreateBuild(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	_, err = h.projectService.GetProject(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Project not found")
		return
	}

	build, err := h.buildService.CreateBuild(r.Context(), projectID, nil, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, build)
}

// GetActiveDeployment returns the active deployment for a project
func (h *ProjectHandler) GetActiveDeployment(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	deployment, err := h.deploymentService.GetActiveDeployment(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusNotFound, "No active deployment")
		return
	}

	writeJSON(w, http.StatusOK, deployment)
}

// StopDeployment stops the active deployment for a project
func (h *ProjectHandler) StopDeployment(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	project, err := h.projectService.GetProject(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Project not found")
		return
	}

	if err := h.deploymentService.StopDeployment(r.Context(), project); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// GetEnvVars returns all env vars for a project
func (h *ProjectHandler) GetEnvVars(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	envVars, err := h.envService.GetEnvVarsAsArray(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, envVars)
}

// SetEnvVar sets an environment variable
func (h *ProjectHandler) SetEnvVar(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := h.envService.SetEnvVar(r.Context(), projectID, req.Key, req.Value); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// DeleteEnvVar deletes an environment variable
func (h *ProjectHandler) DeleteEnvVar(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	key := chi.URLParam(r, "key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "Key is required")
		return
	}

	if err := h.envService.DeleteEnvVar(r.Context(), projectID, key); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
