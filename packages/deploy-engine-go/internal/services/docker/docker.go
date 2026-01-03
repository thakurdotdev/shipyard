package docker

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/thakurdotdev/deploy-engine/internal/logging"
)

// DockerService provides high-level API for Docker container deployments
type DockerService struct {
	logStreamers sync.Map // projectID -> cancel func
}

// NewDockerService creates a new Docker service instance
func NewDockerService() *DockerService {
	return &DockerService{}
}

// Deploy deploys an application as a Docker container
func (d *DockerService) Deploy(
	projectID, buildID, sourceDir string,
	hostPort int,
	appType string,
	envVars map[string]string,
) (success bool, containerID string, err error) {
	containerName := GetContainerName(projectID)
	
	// Determine internal port based on app type
	internalPort := DefaultInternalPort
	if appType == "vite" {
		internalPort = ViteInternalPort
	}

	// 1. Stop any existing container
	logging.StreamLog(buildID, "Preparing container environment...", logging.LogLevelInfo)
	EnsureContainerStopped(projectID)

	// 2. Build the Docker image
	logging.StreamLog(buildID, "Building Docker image...", logging.LogLevelInfo)
	buildResult := BuildImage(
		projectID, buildID, sourceDir,
		FrameworkType(appType), internalPort,
		func(msg string) {
			logging.StreamLog(buildID, msg, logging.LogLevelInfo)
		},
	)

	if !buildResult.Success {
		logging.StreamLog(buildID, fmt.Sprintf("Image build failed: %s", buildResult.Error), logging.LogLevelError)
		return false, "", fmt.Errorf("image build failed: %s", buildResult.Error)
	}

	// 3. Run the container
	logging.StreamLog(buildID, "Starting container...", logging.LogLevelInfo)
	config := ContainerConfig{
		ProjectID:     projectID,
		BuildID:       buildID,
		ImageName:     buildResult.ImageName,
		ContainerName: containerName,
		HostPort:      hostPort,
		InternalPort:  internalPort,
		EnvVars:       envVars,
		MemoryLimit:   DefaultMemoryLimit,
		CPULimit:      DefaultCPULimit,
		WorkDir:       sourceDir,
	}

	runResult := RunContainer(config)
	if !runResult.Success {
		logging.StreamLog(buildID, fmt.Sprintf("Container failed to start: %s", runResult.Error), logging.LogLevelError)
		return false, "", fmt.Errorf("container failed to start: %s", runResult.Error)
	}

	logging.StreamLog(buildID, fmt.Sprintf("Container started: %s", containerName), logging.LogLevelInfo)

	// 4. Health check
	logging.StreamLog(buildID, "Performing health check...", logging.LogLevelInfo)
	if !d.WaitForHealthy(hostPort, 30*time.Second) {
		// Get logs for debugging
		logs := GetContainerLogs(containerName, 50)
		logging.StreamLog(buildID, fmt.Sprintf("Container logs:\n%s", logs), logging.LogLevelWarning)
		logging.StreamLog(buildID, "Health check failed", logging.LogLevelError)
		StopAndRemoveContainer(containerName)
		return false, "", fmt.Errorf("health check failed")
	}

	logging.StreamLog(buildID, "Container deployed successfully!", logging.LogLevelSuccess)

	// 5. Cleanup old images
	PruneProjectImages(projectID, 3)

	// 6. Start background log streaming
	d.StartLogStreaming(projectID, buildID)

	return true, runResult.ContainerID, nil
}

// Stop stops a deployed container
func (d *DockerService) Stop(projectID, buildID string) bool {
	d.StopLogStreaming(projectID)
	containerName := GetContainerName(projectID)

	if buildID != "" {
		logging.StreamLog(buildID, "Stopping container...", logging.LogLevelInfo)
	}

	result := StopAndRemoveContainer(containerName)

	if buildID != "" && result {
		logging.StreamLog(buildID, "Container stopped", logging.LogLevelSuccess)
	}

	return result
}

// Cleanup removes all resources for a project
func (d *DockerService) Cleanup(projectID string, buildIDs []string) {
	d.StopLogStreaming(projectID)
	EnsureContainerStopped(projectID)

	// Remove all images for this project
	for _, buildID := range buildIDs {
		imageName := GetImageName(projectID, buildID)
		RemoveImage(imageName)
	}
}

// WaitForHealthy waits for container to respond to HTTP
func (d *DockerService) WaitForHealthy(port int, timeout time.Duration) bool {
	client := &http.Client{Timeout: 2 * time.Second}
	url := fmt.Sprintf("http://localhost:%d", port)
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 500 {
				return true
			}
		}
		time.Sleep(500 * time.Millisecond)
	}

	return false
}

// IsRunning checks if a project's container is running
func (d *DockerService) IsRunning(projectID string) bool {
	containerName := GetContainerName(projectID)
	return IsContainerRunning(containerName)
}

// GetLogs returns container logs
func (d *DockerService) GetLogs(projectID string, tail int) string {
	containerName := GetContainerName(projectID)
	return GetContainerLogs(containerName, tail)
}

// StartLogStreaming starts background log streaming to control-api
func (d *DockerService) StartLogStreaming(projectID, buildID string) {
	d.StopLogStreaming(projectID)

	containerName := GetContainerName(projectID)
	cancel := StreamContainerLogs(containerName, func(line string) {
		logging.StreamLog(buildID, line, logging.LogLevelInfo)
	})

	d.logStreamers.Store(projectID, cancel)
}

// StopLogStreaming stops log streaming for a project
func (d *DockerService) StopLogStreaming(projectID string) {
	if cancel, ok := d.logStreamers.Load(projectID); ok {
		cancel.(func())()
		d.logStreamers.Delete(projectID)
	}
}

// RecoverLogStreams recovers log streams for running containers on startup
func (d *DockerService) RecoverLogStreams() {
	dockerLog("Recovering log streams for running containers...")
	containers := ListRunningContainers()

	count := 0
	for _, c := range containers {
		d.StartLogStreaming(c.ProjectID, c.BuildID)
		count++
	}

	dockerLog("Recovered log streams for %d containers", count)
}

// Global instance
var defaultDockerService *DockerService
var dockerOnce sync.Once

// GetDockerService returns the singleton DockerService instance
func GetDockerService() *DockerService {
	dockerOnce.Do(func() {
		defaultDockerService = NewDockerService()
	})
	return defaultDockerService
}
