package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/thakurdotdev/build-worker/internal/config"
	"github.com/thakurdotdev/build-worker/internal/utils"
)

// BuildJob represents a build request
type BuildJob struct {
	BuildID        string            `json:"build_id"`
	ProjectID      string            `json:"project_id"`
	GithubURL      string            `json:"github_url"`
	BuildCommand   string            `json:"build_command"`
	RootDirectory  string            `json:"root_directory"`
	AppType        string            `json:"app_type"`
	EnvVars        map[string]string `json:"env_vars"`
	InstallationID string            `json:"installation_id,omitempty"`
}

// BuilderPool manages concurrent build workers
type BuilderPool struct {
	jobs    chan BuildJob
	workers int
	wg      sync.WaitGroup
}

var builderPool *BuilderPool
var poolOnce sync.Once

// GetBuilderPool returns the singleton pool
func GetBuilderPool() *BuilderPool {
	poolOnce.Do(func() {
		cfg := config.Get()
		builderPool = &BuilderPool{
			jobs:    make(chan BuildJob, 100),
			workers: cfg.BuildWorkers,
		}
		builderPool.start()
	})
	return builderPool
}

// start launches worker goroutines
func (p *BuilderPool) start() {
	for i := 0; i < p.workers; i++ {
		p.wg.Add(1)
		go p.worker(i)
	}
	fmt.Printf("[Builder] Started %d workers\n", p.workers)
}

// worker processes jobs from the channel
func (p *BuilderPool) worker(id int) {
	defer p.wg.Done()
	for job := range p.jobs {
		fmt.Printf("[Worker %d] Processing build %s\n", id, job.BuildID)
		if err := ExecuteBuild(job); err != nil {
			fmt.Printf("[Worker %d] Build %s failed: %v\n", id, job.BuildID, err)
		}
	}
}

// Submit adds a job to the queue
func (p *BuilderPool) Submit(job BuildJob) {
	p.jobs <- job
}

// ExecuteBuild runs the full build pipeline
func ExecuteBuild(job BuildJob) error {
	cfg := config.Get()
	workDir := filepath.Join(cfg.WorkspaceDir, job.BuildID)
	ctx := context.Background()

	log := func(msg string, level LogLevel) {
		StreamLog(job.BuildID, job.ProjectID, msg, level)
	}

	updateStatus := func(status string) {
		url := fmt.Sprintf("%s/builds/%s", cfg.ControlAPIURL, job.BuildID)
		payload, _ := json.Marshal(map[string]string{"status": status})
		req, _ := http.NewRequest("PUT", url, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		http.DefaultClient.Do(req)
	}

	defer func() {
		EnsureFlushed(job.BuildID)
		// Cleanup workspace
		os.RemoveAll(workDir)
		fmt.Printf("[Builder] Cleaned up: %s\n", workDir)
	}()

	updateStatus("building")
	log(fmt.Sprintf("Starting build for %s\n", job.BuildID), LogLevelInfo)

	// 1. Authenticate with GitHub if needed
	var token string
	if job.InstallationID != "" {
		log("Authenticating with GitHub App...\n", LogLevelInfo)
		ghService, err := GetGitHubService()
		if err != nil {
			log(fmt.Sprintf("GitHub Auth Failed: %v\n", err), LogLevelError)
			updateStatus("failed")
			return err
		}
		token, err = ghService.GetInstallationToken(job.InstallationID)
		if err != nil {
			log(fmt.Sprintf("GitHub Auth Failed: %v\n", err), LogLevelError)
			updateStatus("failed")
			return err
		}
	}

	// 2. Clone repository
	log("Cloning repository...\n", LogLevelInfo)
	if err := GetGitService().Clone(ctx, job.GithubURL, workDir, token); err != nil {
		log(fmt.Sprintf("Clone failed: %v\n", err), LogLevelError)
		updateStatus("failed")
		return err
	}

	projectDir := filepath.Join(workDir, job.RootDirectory)

	// 3. Handle build based on framework
	if isBackendFramework(job.AppType) {
		needsBuild := utils.NeedsCompilationStep(job.BuildCommand)
		hasBuildScript := utils.HasScript(projectDir, "build")

		if needsBuild && hasBuildScript {
			log("TypeScript backend detected - running build step...\n", LogLevelInfo)
			log("Installing dependencies...\n", LogLevelInfo)
			result := utils.RunCommand(ctx, "bun install", projectDir, job.EnvVars, func(line string) {
				log(line, LogLevelInfo)
			})
			if result.ExitCode != 0 {
				log(fmt.Sprintf("Install failed with exit code %d\n", result.ExitCode), LogLevelError)
				updateStatus("failed")
				return fmt.Errorf("install failed")
			}

			log("Building project...\n", LogLevelInfo)
			result = utils.RunCommand(ctx, job.BuildCommand, projectDir, job.EnvVars, func(line string) {
				log(line, LogLevelInfo)
			})
			if result.ExitCode != 0 {
				log(fmt.Sprintf("Build failed with exit code %d\n", result.ExitCode), LogLevelError)
				updateStatus("failed")
				return fmt.Errorf("build failed")
			}
			log("Build completed successfully!\n", LogLevelSuccess)
		} else {
			log("Backend project detected - skipping build step...\n", LogLevelInfo)
			log("Source code will be packaged and dependencies installed at deploy time.\n", LogLevelInfo)
		}
	} else {
		// Frontend: always install and build
		log("Installing dependencies...\n", LogLevelInfo)
		result := utils.RunCommand(ctx, "bun install", projectDir, job.EnvVars, func(line string) {
			log(line, LogLevelInfo)
		})
		if result.ExitCode != 0 {
			log(fmt.Sprintf("Install failed with exit code %d\n", result.ExitCode), LogLevelError)
			updateStatus("failed")
			return fmt.Errorf("install failed")
		}

		log("Building project...\n", LogLevelInfo)
		result = utils.RunCommand(ctx, job.BuildCommand, projectDir, job.EnvVars, func(line string) {
			log(line, LogLevelInfo)
		})
		if result.ExitCode != 0 {
			log(fmt.Sprintf("Build failed with exit code %d\n", result.ExitCode), LogLevelError)
			updateStatus("failed")
			return fmt.Errorf("build failed")
		}
		log("Build completed successfully!\n", LogLevelSuccess)
	}

	// 4. Create and upload artifact
	log("Creating artifact package...\n", LogLevelInfo)
	log("Streaming artifact to Deploy Engine...\n", LogLevelInfo)

	if err := GetArtifactService().StreamArtifact(job.BuildID, projectDir, job.AppType); err != nil {
		log(fmt.Sprintf("Artifact upload failed: %v\n", err), LogLevelError)
		updateStatus("failed")
		return err
	}

	log("Artifact uploaded successfully!\n", LogLevelSuccess)
	updateStatus("success")
	return nil
}
