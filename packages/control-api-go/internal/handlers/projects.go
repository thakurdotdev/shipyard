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

type ProjectHandler struct {
	projectService    *services.ProjectService
	buildService      *services.BuildService
	deploymentService *services.DeploymentService
	envService        *services.EnvService
	broadcaster       *sse.Broadcaster
}

func NewProjectHandler(pool *pgxpool.Pool) *ProjectHandler {
	envService, _ := services.NewEnvService(pool)
	return &ProjectHandler{
		projectService:    services.NewProjectService(pool),
		buildService:      services.NewBuildService(pool),
		deploymentService: services.NewDeploymentService(pool),
		envService:        envService,
		broadcaster:       sse.GetBroadcaster(),
	}
}

func (h *ProjectHandler) Routes() chi.Router {
	r := chi.NewRouter()

	// List and create (no path params)
	r.Get("/", h.List)
	r.Post("/", h.Create)
	
	// Specific routes MUST come before generic /{id} to avoid conflicts
	r.Get("/{id}/stream", h.Stream)
	r.Get("/{id}/builds", h.ListBuilds)
	r.Post("/{id}/builds", h.CreateBuild)
	r.Get("/{id}/deployment", h.GetActiveDeployment)
	r.Post("/{id}/stop", h.StopDeployment)
	r.Get("/{id}/env", h.GetEnvVars)
	r.Post("/{id}/env", h.SetEnvVar)
	r.Delete("/{id}/env/{key}", h.DeleteEnvVar)
	
	// Generic CRUD operations (must be LAST)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)

	return r
}

// List returns all projects
func (h *ProjectHandler) List(w http.ResponseWriter, r *http.Request) {
	projects, err := h.projectService.ListProjects(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

// Get returns a single project
func (h *ProjectHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	project, err := h.projectService.GetProject(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "Project not found")
		return
	}

	writeJSON(w, http.StatusOK, project)
}

// Create creates a new project
func (h *ProjectHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name                 string  `json:"name"`
		GithubURL            string  `json:"github_url"`
		RootDirectory        *string `json:"root_directory"`
		BuildCommand         string  `json:"build_command"`
		AppType              string  `json:"app_type"`
		Domain               *string `json:"domain"`
		GithubRepoID         *string `json:"github_repo_id"`
		GithubRepoFullName   *string `json:"github_repo_full_name"`
		GithubBranch         *string `json:"github_branch"`
		GithubInstallationID *string `json:"github_installation_id"`
		AutoDeploy           *bool   `json:"auto_deploy"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Set defaults
	rootDir := "./"
	if req.RootDirectory != nil {
		rootDir = *req.RootDirectory
	}
	autoDeploy := true
	if req.AutoDeploy != nil {
		autoDeploy = *req.AutoDeploy
	}
	branch := "main"
	if req.GithubBranch != nil {
		branch = *req.GithubBranch
	}

	project, err := h.projectService.CreateProject(r.Context(), db.CreateProjectParams{
		Name:                 req.Name,
		GithubUrl:            req.GithubURL,
		RootDirectory:        db.ToPgText(rootDir),
		BuildCommand:         req.BuildCommand,
		AppType:              req.AppType,
		Domain:               db.ToPgTextPtr(req.Domain),
		GithubRepoID:         db.ToPgTextPtr(req.GithubRepoID),
		GithubRepoFullName:   db.ToPgTextPtr(req.GithubRepoFullName),
		GithubBranch:         db.ToPgText(branch),
		GithubInstallationID: db.ToPgTextPtr(req.GithubInstallationID),
		AutoDeploy:           autoDeploy,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, project)
}

// Update updates a project
func (h *ProjectHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	var req db.UpdateProjectParams
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	project, err := h.projectService.UpdateProject(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, project)
}

// Delete deletes a project
func (h *ProjectHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	if err := h.projectService.DeleteProject(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// Stream handles SSE streaming for project updates
func (h *ProjectHandler) Stream(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(projectID); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}

	h.broadcaster.ServeProjectSSE(w, r, projectID)
}

// Helper functions
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
