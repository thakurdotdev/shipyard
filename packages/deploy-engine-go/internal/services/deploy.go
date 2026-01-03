package services

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/thakurdotdev/deploy-engine/internal/config"
)

type DeployService struct {
	artifactsDir string
	appsDir      string
	nginx        *NginxService
}

func NewDeployService() *DeployService {
	cfg := config.Get()

	// Convert to absolute paths
	artifactsDir := cfg.ArtifactsDir
	appsDir := cfg.AppsDir

	if !filepath.IsAbs(artifactsDir) {
		if abs, err := filepath.Abs(artifactsDir); err == nil {
			artifactsDir = abs
		}
	}
	if !filepath.IsAbs(appsDir) {
		if abs, err := filepath.Abs(appsDir); err == nil {
			appsDir = abs
		}
	}

	// Ensure directories exist
	os.MkdirAll(artifactsDir, 0755)
	os.MkdirAll(appsDir, 0755)

	return &DeployService{
		artifactsDir: artifactsDir,
		appsDir:      appsDir,
		nginx:        NewNginxService(),
	}
}

type ActivateRequest struct {
	ProjectID string            `json:"projectId"`
	BuildID   string            `json:"buildId"`
	Port      int               `json:"port"`
	AppType   config.AppType    `json:"appType"`
	Subdomain string            `json:"subdomain"`
	EnvVars   map[string]string `json:"envVars"`
}

func (d *DeployService) ReceiveArtifact(buildID string, body io.Reader) (string, error) {
	artifactPath := filepath.Join(d.artifactsDir, buildID+".tar.gz")

	file, err := os.Create(artifactPath)
	if err != nil {
		return "", fmt.Errorf("failed to create artifact file: %w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, body); err != nil {
		return "", fmt.Errorf("failed to write artifact: %w", err)
	}

	return artifactPath, nil
}

func (d *DeployService) ActivateDeployment(req ActivateRequest) error {
	paths := d.getPaths(req.ProjectID, req.BuildID)

	StreamLog(req.BuildID, "Starting deployment activation...", LogLevelInfo)

	// 1. Extract artifact
	StreamLog(req.BuildID, "Extracting artifact...", LogLevelInfo)
	if err := d.extractArtifact(paths.artifact, paths.buildDir); err != nil {
		StreamLog(req.BuildID, fmt.Sprintf("Failed to extract artifact: %v", err), LogLevelError)
		return err
	}

	// 2. Update symlink for zero-downtime
	StreamLog(req.BuildID, "Updating deployment symlink...", LogLevelInfo)
	if err := d.updateSymlink(paths.projectDir, paths.buildDir, req.BuildID); err != nil {
		StreamLog(req.BuildID, fmt.Sprintf("Failed to update symlink: %v", err), LogLevelError)
		return err
	}

	currentLink := filepath.Join(paths.projectDir, "current")
	currentDir, err := filepath.EvalSymlinks(currentLink)
	if err != nil {
		StreamLog(req.BuildID, fmt.Sprintf("Failed to resolve symlink: %v", err), LogLevelError)
		return err
	}

	// Check if Docker mode is enabled
	if config.Get().UseDocker {
		return d.activateWithDocker(req, currentDir)
	}

	return d.activateWithProcess(req, currentDir, paths.projectDir)
}

// activateWithDocker deploys using Docker containers
func (d *DeployService) activateWithDocker(req ActivateRequest, sourceDir string) error {
	StreamLog(req.BuildID, "Using Docker deployment mode...", LogLevelInfo)

	dockerSvc := GetDockerService()
	success, _, err := dockerSvc.Deploy(
		req.ProjectID, req.BuildID, sourceDir,
		req.Port, string(req.AppType), req.EnvVars,
	)

	if err != nil || !success {
		return err
	}

	// Configure Nginx
	if config.IsProduction() && req.Subdomain != "" {
		StreamLog(req.BuildID, "Configuring Nginx...", LogLevelInfo)
		if err := d.nginx.CreateConfig(req.Subdomain, req.Port); err != nil {
			StreamLog(req.BuildID, fmt.Sprintf("Failed to configure Nginx: %v", err), LogLevelWarning)
		}
	}

	return nil
}

// activateWithProcess deploys by running the app directly (original flow)
func (d *DeployService) activateWithProcess(req ActivateRequest, currentDir, projectDir string) error {
	// Check if static server needed
	if config.ShouldUseStaticServer(req.AppType, currentDir) {
		StreamLog(req.BuildID, "Static build detected, using static server...", LogLevelInfo)
	} else {
		// Kill existing process
		StreamLog(req.BuildID, "Stopping existing process...", LogLevelInfo)
		d.killProjectProcess(req.ProjectID, req.Port)

		// Ensure port is free
		if err := d.ensurePortFree(req.Port); err != nil {
			StreamLog(req.BuildID, fmt.Sprintf("Port %d not available: %v", req.Port, err), LogLevelError)
			return err
		}

		// Install dependencies if needed
		fw := config.Frameworks[req.AppType]
		if fw.RequiresInstall {
			StreamLog(req.BuildID, "Installing dependencies...", LogLevelInfo)
			if err := d.ensureDependenciesInstalled(currentDir); err != nil {
				StreamLog(req.BuildID, fmt.Sprintf("Failed to install dependencies: %v", err), LogLevelError)
				return err
			}
		}

		// Start application
		StreamLog(req.BuildID, "Starting application...", LogLevelInfo)
		if err := d.startApplication(currentDir, req.Port, req.AppType, projectDir, req.BuildID, req.EnvVars); err != nil {
			StreamLog(req.BuildID, fmt.Sprintf("Failed to start application: %v", err), LogLevelError)
			return err
		}

		// Health check
		StreamLog(req.BuildID, "Performing health check...", LogLevelInfo)
		if err := d.performHealthCheck(req.Port); err != nil {
			StreamLog(req.BuildID, fmt.Sprintf("Health check failed: %v", err), LogLevelError)
			return err
		}
	}

	// Configure Nginx
	if config.IsProduction() && req.Subdomain != "" {
		StreamLog(req.BuildID, "Configuring Nginx...", LogLevelInfo)
		if err := d.nginx.CreateConfig(req.Subdomain, req.Port); err != nil {
			StreamLog(req.BuildID, fmt.Sprintf("Failed to configure Nginx: %v", err), LogLevelWarning)
		}
	}

	StreamLog(req.BuildID, "Deployment activated successfully!", LogLevelSuccess)
	return nil
}

func (d *DeployService) StopDeployment(port int, projectID, buildID string) error {
	if buildID != "" {
		StreamLog(buildID, "Stopping deployment...", LogLevelInfo)
	}

	if config.Get().UseDocker {
		GetDockerService().Stop(projectID, buildID)
	} else {
		d.killProjectProcess(projectID, port)
	}

	if buildID != "" {
		StreamLog(buildID, "Deployment stopped", LogLevelSuccess)
	}
	return nil
}

func (d *DeployService) DeleteProject(projectID string, port int, subdomain string, buildIDs []string) error {
	// Stop using appropriate method
	if config.Get().UseDocker {
		GetDockerService().Cleanup(projectID, buildIDs)
	} else if port > 0 {
		d.killProjectProcess(projectID, port)
	}

	// Remove Nginx config
	if subdomain != "" && config.IsProduction() {
		d.nginx.RemoveConfig(subdomain)
	}

	// Remove artifacts
	for _, buildID := range buildIDs {
		artifactPath := filepath.Join(d.artifactsDir, buildID+".tar.gz")
		os.Remove(artifactPath)
	}

	// Remove project directory
	projectDir := filepath.Join(d.appsDir, projectID)
	os.RemoveAll(projectDir)

	return nil
}

// --- Helper Methods ---

type deployPaths struct {
	artifact   string
	projectDir string
	buildDir   string
}

func (d *DeployService) getPaths(projectID, buildID string) deployPaths {
	return deployPaths{
		artifact:   filepath.Join(d.artifactsDir, buildID+".tar.gz"),
		projectDir: filepath.Join(d.appsDir, projectID),
		buildDir:   filepath.Join(d.appsDir, projectID, "builds", buildID),
	}
}

func (d *DeployService) extractArtifact(artifact, target string) error {
	os.MkdirAll(target, 0755)

	cmd := exec.Command("tar", "-xzf", artifact, "-C", target)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("tar extraction failed: %s", string(out))
	}
	return nil
}

func (d *DeployService) updateSymlink(projectDir, target, buildID string) error {
	os.MkdirAll(projectDir, 0755)

	currentLink := filepath.Join(projectDir, "current")
	tempLink := filepath.Join(projectDir, "current.tmp")

	// Remove old temp link if exists
	os.Remove(tempLink)

	// Create new symlink atomically
	if err := os.Symlink(target, tempLink); err != nil {
		return fmt.Errorf("failed to create temp symlink: %w", err)
	}

	if err := os.Rename(tempLink, currentLink); err != nil {
		os.Remove(tempLink)
		return fmt.Errorf("failed to rename symlink: %w", err)
	}

	return nil
}

func (d *DeployService) killProjectProcess(projectID string, port int) {
	if port <= 0 {
		return
	}

	// Find process using the port with lsof
	cmd := exec.Command("lsof", "-t", "-i", fmt.Sprintf(":%d", port))
	out, err := cmd.Output()
	if err != nil {
		return
	}

	pids := strings.Fields(strings.TrimSpace(string(out)))
	for _, pidStr := range pids {
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}
		syscall.Kill(pid, syscall.SIGTERM)
	}

	// Wait briefly for graceful shutdown
	time.Sleep(500 * time.Millisecond)

	// Force kill if still running
	for _, pidStr := range pids {
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}
		syscall.Kill(pid, syscall.SIGKILL)
	}
}

func (d *DeployService) ensurePortFree(port int) error {
	for i := 0; i < 10; i++ {
		cmd := exec.Command("lsof", "-t", "-i", fmt.Sprintf(":%d", port))
		if out, _ := cmd.Output(); len(strings.TrimSpace(string(out))) == 0 {
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("port %d still in use after retries", port)
}

func (d *DeployService) ensureDependenciesInstalled(cwd string) error {
	nodeModules := filepath.Join(cwd, "node_modules")
	if _, err := os.Stat(nodeModules); err == nil {
		return nil // Already installed
	}

	cmd := exec.Command(config.Get().BunPath, "install")
	cmd.Dir = cwd
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}

func (d *DeployService) startApplication(cwd string, port int, appType config.AppType, projectDir, buildID string, envVars map[string]string) error {
	fw := config.Frameworks[appType]

	var cmdArgs []string
	if config.IsBackendFramework(appType) {
		cmdArgs = config.GetBackendStartCommand(cwd)
	} else {
		cmdArgs = fw.StartCommand(port, cwd)
	}

	if len(cmdArgs) == 0 {
		return nil // Static build, no process needed
	}

	StreamLog(buildID, fmt.Sprintf("Running: %v", cmdArgs), LogLevelInfo)

	cmd := exec.Command(cmdArgs[0], cmdArgs[1:]...)
	cmd.Dir = cwd

	// Set up environment
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, fmt.Sprintf("PORT=%d", port))
	for k, v := range envVars {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	// Capture output for debugging
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	// Write PID file for tracking
	pidFile := filepath.Join(projectDir, "current.pid")

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start process: %w", err)
	}

	os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644)
	StreamLog(buildID, fmt.Sprintf("Process started with PID %d on port %d", cmd.Process.Pid, port), LogLevelInfo)

	// Stream output in background for debugging
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				fmt.Print(string(buf[:n]))
			}
			if err != nil {
				break
			}
		}
	}()
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				fmt.Print(string(buf[:n]))
			}
			if err != nil {
				break
			}
		}
	}()

	// Wait for process to die or succeed in background
	go func() {
		cmd.Wait()
	}()

	// Give the app a moment to start up before we begin health checks
	time.Sleep(2 * time.Second)

	return nil
}

func (d *DeployService) performHealthCheck(port int) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := &http.Client{Timeout: 2 * time.Second}
	url := fmt.Sprintf("http://localhost:%d", port)

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("health check timed out")
		default:
			resp, err := client.Get(url)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode < 500 {
					return nil
				}
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
}

var defaultDeployService *DeployService

func GetDeployService() *DeployService {
	if defaultDeployService == nil {
		defaultDeployService = NewDeployService()
	}
	return defaultDeployService
}
