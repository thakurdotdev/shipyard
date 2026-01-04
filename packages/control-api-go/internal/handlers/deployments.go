package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/services"
)

type DeploymentHandler struct {
	deploymentService *services.DeploymentService
	buildService      *services.BuildService
	projectService    *services.ProjectService
	envService        *services.EnvService
}

func NewDeploymentHandler(pool *pgxpool.Pool) *DeploymentHandler {
	envService, _ := services.NewEnvService(pool)
	return &DeploymentHandler{
		deploymentService: services.NewDeploymentService(pool),
		buildService:      services.NewBuildService(pool),
		projectService:    services.NewProjectService(pool),
		envService:        envService,
	}
}

func (h *DeploymentHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/{projectId}", h.GetActive)
	r.Get("/{projectId}/list", h.List)
	r.Post("/{projectId}/stop", h.Stop)

	return r
}

// GetActive returns the active deployment for a project
func (h *DeploymentHandler) GetActive(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "projectId"))
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

// List returns all deployments for a project
func (h *DeploymentHandler) List(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "projectId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	deployments, err := h.deploymentService.ListDeployments(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, deployments)
}

// Stop stops the active deployment
func (h *DeploymentHandler) Stop(w http.ResponseWriter, r *http.Request) {
	projectID, err := uuid.Parse(chi.URLParam(r, "projectId"))
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
