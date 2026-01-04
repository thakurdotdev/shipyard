package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/db"
	"github.com/thakurdotdev/control-api/internal/services"
	"github.com/thakurdotdev/control-api/internal/sse"
)

type BuildHandler struct {
	buildService      *services.BuildService
	projectService    *services.ProjectService
	envService        *services.EnvService
	deploymentService *services.DeploymentService
	broadcaster       *sse.Broadcaster
}

func NewBuildHandler(pool *pgxpool.Pool) *BuildHandler {
	envService, _ := services.NewEnvService(pool)
	return &BuildHandler{
		buildService:      services.NewBuildService(pool),
		projectService:    services.NewProjectService(pool),
		envService:        envService,
		deploymentService: services.NewDeploymentService(pool),
		broadcaster:       sse.GetBroadcaster(),
	}
}

func (h *BuildHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/{id}", h.Get)
	r.Get("/{id}/logs", h.GetLogs)
	r.Delete("/{id}/logs", h.ClearLogs)
	r.Get("/{id}/stream", h.StreamLogs) // SSE endpoint

	return r
}

// InternalRoutes returns routes for internal services (no auth)
func (h *BuildHandler) InternalRoutes() chi.Router {
	r := chi.NewRouter()

	r.Put("/{id}", h.UpdateStatus)
	r.Post("/{id}/logs", h.AppendLog)

	return r
}

// Get returns a build by ID
func (h *BuildHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid build ID")
		return
	}

	build, err := h.buildService.GetBuild(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "Build not found")
		return
	}

	writeJSON(w, http.StatusOK, build)
}

// GetLogs returns logs for a build
func (h *BuildHandler) GetLogs(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid build ID")
		return
	}

	logs, err := h.buildService.GetBuildLogs(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, logs)
}

// ClearLogs clears logs for a build
func (h *BuildHandler) ClearLogs(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid build ID")
		return
	}

	if err := h.buildService.ClearBuildLogs(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// StreamLogs handles SSE streaming for build logs
func (h *BuildHandler) StreamLogs(w http.ResponseWriter, r *http.Request) {
	buildID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(buildID); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid build ID")
		return
	}

	h.broadcaster.ServeHTTP(w, r, buildID)
}

// UpdateStatus updates build status (internal endpoint)
func (h *BuildHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid build ID")
		return
	}

	var req struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	build, err := h.buildService.UpdateBuildStatus(r.Context(), id, req.Status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// If build succeeded, trigger deployment
	if req.Status == "success" {
		projectID := db.FromPgUUID(build.ProjectID)
		project, err := h.projectService.GetProject(r.Context(), projectID)
		if err == nil {
			envVars, _ := h.envService.GetEnvVarsForBuild(r.Context(), projectID)
			buildID := db.FromPgUUID(build.ID)
			h.deploymentService.ActivateDeployment(r.Context(), project, buildID, envVars)
		}
	}

	writeJSON(w, http.StatusOK, build)
}

// AppendLog appends a log entry (internal endpoint)
func (h *BuildHandler) AppendLog(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid build ID")
		return
	}

	var req struct {
		Logs  string `json:"logs"`
		Level string `json:"level"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Level == "" {
		req.Level = "info"
	}

	if err := h.buildService.AppendBuildLog(r.Context(), id, req.Logs, req.Level); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// TriggerBuild triggers a new build for a project
func (h *BuildHandler) TriggerBuild(w http.ResponseWriter, r *http.Request) {
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

	// Create build record
	build, err := h.buildService.CreateBuild(r.Context(), projectID, nil, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Get env vars
	envVars, _ := h.envService.GetEnvVarsForBuild(r.Context(), projectID)

	// Trigger build worker
	buildID := db.FromPgUUID(build.ID)
	if err := h.buildService.TriggerBuildWorker(r.Context(), project, build, envVars); err != nil {
		h.buildService.UpdateBuildStatus(r.Context(), buildID, "failed")
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, build)
}
