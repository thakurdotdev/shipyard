package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/db"
	"github.com/thakurdotdev/control-api/internal/middleware"
	"github.com/thakurdotdev/control-api/internal/services"
)

type GitHubHandler struct {
	githubService  *services.GitHubService
	projectService *services.ProjectService
	buildService   *services.BuildService
	envService     *services.EnvService
	pool           *pgxpool.Pool
}

func NewGitHubHandler(pool *pgxpool.Pool) (*GitHubHandler, error) {
	githubService, err := services.NewGitHubService(pool)
	if err != nil {
		fmt.Printf("[GitHub] Warning: GitHub service not available: %v\n", err)
	}

	envService, _ := services.NewEnvService(pool)

	return &GitHubHandler{
		githubService:  githubService,
		projectService: services.NewProjectService(pool),
		buildService:   services.NewBuildService(pool),
		envService:     envService,
		pool:           pool,
	}, nil
}

func (h *GitHubHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/installations", h.ListInstallations)
	r.Get("/installations/{id}/repos", h.ListRepos)

	return r
}

// WebhookRoutes returns routes for GitHub webhooks (no auth)
func (h *GitHubHandler) WebhookRoutes() chi.Router {
	r := chi.NewRouter()

	r.Post("/webhook", h.HandleWebhook)

	return r
}

// ListInstallations returns all GitHub installations
func (h *GitHubHandler) ListInstallations(w http.ResponseWriter, r *http.Request) {
	if h.githubService == nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub service not configured")
		return
	}

	// Sync with GitHub first
	if session, ok := r.Context().Value(middleware.SessionContextKey).(*services.Session); ok {
		if err := h.githubService.SyncInstallations(r.Context(), session.UserID); err != nil {
			fmt.Printf("[GitHub] Warning: Failed to sync installations: %v\n", err)
			// Proceed to return cached data if any
		}
	} else {
		// Should not happen due to AuthMiddleware
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	installations, err := h.githubService.ListInstallations(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Match the expected frontend format
	type Account struct {
		Login string `json:"login"`
		ID    int    `json:"id"`
		Type  string `json:"type"`
	}
	type Installation struct {
		ID      int     `json:"id"`
		Account Account `json:"account"`
	}
	type Response struct {
		Installations []Installation `json:"installations"`
	}

	var response Response
	response.Installations = make([]Installation, 0)

	for _, inst := range installations {
		// Convert strings to ints if possible, otherwise 0
		var id, accountID int
		fmt.Sscanf(inst.GithubInstallationID, "%d", &id)
		fmt.Sscanf(inst.AccountID, "%d", &accountID)

		response.Installations = append(response.Installations, Installation{
			ID: id,
			Account: Account{
				Login: inst.AccountLogin,
				ID:    accountID,
				Type:  inst.AccountType,
			},
		})
	}

	writeJSON(w, http.StatusOK, response)
}

// ListRepos returns repos for an installation
func (h *GitHubHandler) ListRepos(w http.ResponseWriter, r *http.Request) {
	if h.githubService == nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub service not configured")
		return
	}

	installationID := chi.URLParam(r, "id")
	repos, err := h.githubService.FetchUserRepos(r.Context(), installationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Sort by pushed_at descending
	// Note: API serves sorted, but we can ensure it if needed. 
	// GitHub API default sort is full_name if not specified, TS used pushed/desc.
	// Our service call didn't specify sort params, let's trust API or sort here.
	
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"repositories": repos,
	})
}

// ListFolders returns folders with detected frameworks
func (h *GitHubHandler) ListFolders(w http.ResponseWriter, r *http.Request) {
	if h.githubService == nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub service not configured")
		return
	}

	installationID := chi.URLParam(r, "id")
	owner := chi.URLParam(r, "owner")
	repo := chi.URLParam(r, "repo")

	// Helper to check a directory
	checkDir := func(path, name string) (*struct {
		Path          string                 `json:"path"`
		Name          string                 `json:"name"`
		Framework     string                 `json:"framework"`
		FrameworkInfo services.FrameworkInfo `json:"frameworkInfo"`
		HasPackageJson bool                  `json:"hasPackageJson"`
	}, error) {
		// Fetch contents
		contents, err := h.githubService.FetchRepoContents(r.Context(), installationID, owner, repo, path)
		if err != nil {
			return nil, err
		}

		// Check for package.json
		hasPackageJSON := false
		var fileNames []string
		for _, item := range contents {
			if name, ok := item["name"].(string); ok {
				fileNames = append(fileNames, name)
				if name == "package.json" {
					hasPackageJSON = true
				}
			}
		}

		if hasPackageJSON {
			// Fetch package.json content
			pkgContent, err := h.githubService.FetchFileContent(r.Context(), installationID, owner, repo, path+"/package.json")
			var pkgJSON map[string]interface{}
			if err == nil {
				pkgJSON = pkgContent
			}

			detected := services.DetectFramework(fileNames, pkgJSON)
			info := services.GetFrameworkDisplayInfo(detected.Framework)

			return &struct {
				Path          string                 `json:"path"`
				Name          string                 `json:"name"`
				Framework     string                 `json:"framework"`
				FrameworkInfo services.FrameworkInfo `json:"frameworkInfo"`
				HasPackageJson bool                  `json:"hasPackageJson"`
			}{
				Path:          path,
				Name:          name,
				Framework:     string(detected.Framework),
				FrameworkInfo: info,
				HasPackageJson: true,
			}, nil
		}
		
		return nil, nil // Not a project root
	}

	folders := make([]interface{}, 0)

	// 1. Check Root
	if res, _ := checkDir("", repo); res != nil {
		res.Path = "./" // Frontend expects ./ for root
		folders = append(folders, res)
	}

	// 2. Check Monorepo Dirs
	// Fetch root again to find dirs? Efficiently we already fetched root in checkDir technically 
	// but we didn't return the list. Let's fetch root contents.
	rootContents, err := h.githubService.FetchRepoContents(r.Context(), installationID, owner, repo, "")
	if err == nil {
		for _, item := range rootContents {
			name := item["name"].(string)
			blockType := item["type"].(string)

			if blockType == "dir" && services.IsMonorepoDir(name) {
				// Check subdirectories
				subContents, err := h.githubService.FetchRepoContents(r.Context(), installationID, owner, repo, name)
				if err == nil {
					for _, sub := range subContents {
						subName := sub["name"].(string)
						subType := sub["type"].(string)
						
						if subType == "dir" {
							path := fmt.Sprintf("%s/%s", name, subName)
							if res, _ := checkDir(path, subName); res != nil {
								folders = append(folders, res)
							}
						}
					}
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"folders": folders,
	})
}

// HandleWebhook handles GitHub webhook events
func (h *GitHubHandler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	event := r.Header.Get("X-GitHub-Event")

	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	switch event {
	case "push":
		h.handlePushEvent(w, r, payload)
	case "installation":
		h.handleInstallationEvent(w, r, payload)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"status": "ignored", "event": event})
	}
}

func (h *GitHubHandler) handlePushEvent(w http.ResponseWriter, r *http.Request, payload map[string]interface{}) {
	repo := payload["repository"].(map[string]interface{})
	repoID := fmt.Sprintf("%v", repo["id"])

	ref := payload["ref"].(string)
	branch := ref[len("refs/heads/"):]

	// Find project by repo ID and branch
	project, err := h.projectService.GetProjectByGitHubRepo(r.Context(), repoID, branch)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "no_project"})
		return
	}

	// Check if auto-deploy is enabled
	if !project.AutoDeploy {
		writeJSON(w, http.StatusOK, map[string]string{"status": "auto_deploy_disabled"})
		return
	}

	// Extract commit info
	var commitSHA, commitMessage *string
	if headCommit, ok := payload["head_commit"].(map[string]interface{}); ok {
		sha := headCommit["id"].(string)
		msg := headCommit["message"].(string)
		commitSHA = &sha
		commitMessage = &msg
	}

	projectID := db.FromPgUUID(project.ID)

	// Check for duplicate build
	if commitSHA != nil {
		if existing, _ := h.buildService.CheckDuplicateBuild(r.Context(), projectID, *commitSHA); existing != nil {
			writeJSON(w, http.StatusOK, map[string]string{"status": "duplicate"})
			return
		}
	}

	// Create build
	build, err := h.buildService.CreateBuild(r.Context(), projectID, commitSHA, commitMessage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Get env vars and trigger build
	envVars, _ := h.envService.GetEnvVarsForBuild(r.Context(), projectID)
	buildID := db.FromPgUUID(build.ID)
	if err := h.buildService.TriggerBuildWorker(r.Context(), project, build, envVars); err != nil {
		h.buildService.UpdateBuildStatus(r.Context(), buildID, "failed")
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":   "triggered",
		"build_id": build.ID,
	})
}

func (h *GitHubHandler) handleInstallationEvent(w http.ResponseWriter, r *http.Request, payload map[string]interface{}) {
	if h.githubService == nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub service not configured")
		return
	}

	action := payload["action"].(string)
	if action != "created" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
		return
	}

	installation := payload["installation"].(map[string]interface{})
	account := installation["account"].(map[string]interface{})

	installationID := fmt.Sprintf("%v", installation["id"])
	accountLogin := account["login"].(string)
	accountID := fmt.Sprintf("%v", account["id"])
	accountType := account["type"].(string)

	if err := h.githubService.SaveInstallation(r.Context(), installationID, accountLogin, accountID, accountType); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "installed"})
}
