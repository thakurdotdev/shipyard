package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/services"
)

type EnvHandler struct {
	envService     *services.EnvService
	projectService *services.ProjectService
}

func NewEnvHandler(pool *pgxpool.Pool) *EnvHandler {
	envService, _ := services.NewEnvService(pool)
	return &EnvHandler{
		envService:     envService,
		projectService: services.NewProjectService(pool),
	}
}

func (h *EnvHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/{projectId}", h.List)
	r.Post("/{projectId}", h.Set)
	r.Delete("/{projectId}/{key}", h.Delete)

	return r
}

// List returns all env vars for a project (masked)
func (h *EnvHandler) List(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "projectId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	vars, err := h.envService.GetEnvVarsMasked(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, vars)
}

// Set creates or updates an env var
func (h *EnvHandler) Set(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "projectId"))
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

	if req.Key == "" {
		writeError(w, http.StatusBadRequest, "Key is required")
		return
	}

	if err := h.envService.SetEnvVar(r.Context(), projectID, req.Key, req.Value); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// Delete removes an env var
func (h *EnvHandler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "projectId"))
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
