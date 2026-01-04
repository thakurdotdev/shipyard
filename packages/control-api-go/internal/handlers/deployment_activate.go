package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/thakurdotdev/control-api/internal/db"
)

// ActivateBuild activates a build deployment
func (h *DeploymentHandler) ActivateBuild(w http.ResponseWriter, r *http.Request) {
	buildID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid build ID")
		return
	}

	build, err := h.buildService.GetBuild(r.Context(), buildID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Build not found")
		return
	}

	projectID := db.FromPgUUID(build.ProjectID)
	project, err := h.projectService.GetProject(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Project not found")
		return
	}

	envVars, _ := h.envService.GetEnvVarsForBuild(r.Context(), projectID)
	
	if err := h.deploymentService.ActivateDeployment(r.Context(), project, buildID, envVars); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
