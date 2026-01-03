package docker

import (
	"bufio"
	"fmt"
	"os/exec"
	"strings"
)

// RunContainer starts a container with the given configuration
func RunContainer(config ContainerConfig) RunResult {
	// Build environment variable flags
	envFlags := []string{}
	for key, value := range config.EnvVars {
		envFlags = append(envFlags, "-e", fmt.Sprintf("%s=%s", key, value))
	}

	// Ensure PORT is always set
	if _, hasPort := config.EnvVars["PORT"]; !hasPort {
		envFlags = append(envFlags, "-e", fmt.Sprintf("PORT=%d", config.InternalPort))
	}

	args := []string{
		"run", "-d",
		"--name", config.ContainerName,
		"-p", fmt.Sprintf("%d:%d", config.HostPort, config.InternalPort),
		"--restart", "unless-stopped",
		"--memory", config.MemoryLimit,
		"--cpus", config.CPULimit,
		"--label", fmt.Sprintf("thakur.projectId=%s", config.ProjectID),
		"--label", fmt.Sprintf("thakur.buildId=%s", config.BuildID),
		"-e", "NODE_ENV=production",
	}
	args = append(args, envFlags...)
	args = append(args, config.ImageName)

	result := ExecDocker(args...)

	if result.ExitCode != 0 {
		errMsg := result.Stderr
		if errMsg == "" {
			errMsg = "Failed to start container"
		}
		return RunResult{Success: false, Error: errMsg}
	}

	return RunResult{
		Success:     true,
		ContainerID: strings.TrimSpace(result.Stdout),
	}
}

// StopContainer gracefully stops a container
func StopContainer(containerName string, timeout int) bool {
	result := ExecDocker("stop", "-t", fmt.Sprintf("%d", timeout), containerName)
	return result.ExitCode == 0
}

// RemoveContainer removes a container
func RemoveContainer(containerName string, force bool) bool {
	args := []string{"rm"}
	if force {
		args = append(args, "-f")
	}
	args = append(args, containerName)
	result := ExecDocker(args...)
	return result.ExitCode == 0
}

// StopAndRemoveContainer stops then removes a container
func StopAndRemoveContainer(containerName string) bool {
	StopContainer(containerName, 10)
	return RemoveContainer(containerName, true)
}

// GetContainerInfo returns container state information
func GetContainerInfo(containerName string) *ContainerInfo {
	result := ExecDocker("inspect", "--format", "{{.Id}} {{.State.Status}}", containerName)
	if result.ExitCode != 0 {
		return nil
	}

	parts := strings.Fields(strings.TrimSpace(result.Stdout))
	if len(parts) < 2 {
		return nil
	}

	return &ContainerInfo{
		ID:     parts[0],
		Name:   containerName,
		Status: parts[1],
	}
}

// ContainerExists checks if a container exists
func ContainerExists(containerName string) bool {
	result := ExecDocker("container", "inspect", containerName)
	return result.ExitCode == 0
}

// IsContainerRunning checks if a container is currently running
func IsContainerRunning(containerName string) bool {
	info := GetContainerInfo(containerName)
	return info != nil && info.Status == "running"
}

// GetContainerLogs returns the last N lines of container logs
func GetContainerLogs(containerName string, tail int) string {
	result := ExecDocker("logs", "--tail", fmt.Sprintf("%d", tail), containerName)
	return result.Stdout + result.Stderr
}

// StreamContainerLogs streams container logs in real-time
// Returns a cancel function to stop streaming
func StreamContainerLogs(containerName string, onLog func(string)) func() {
	cmd := exec.Command("docker", "logs", "-f", "--tail", "0", containerName)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	cmd.Start()

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			onLog(scanner.Text())
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			onLog(scanner.Text())
		}
	}()

	return func() {
		cmd.Process.Kill()
	}
}

// EnsureContainerStopped stops and removes any existing container for a project
func EnsureContainerStopped(projectID string) {
	containerName := GetContainerName(projectID)
	if ContainerExists(containerName) {
		StopAndRemoveContainer(containerName)
	}
}

// RunningContainer represents a managed container
type RunningContainer struct {
	ContainerName string
	ProjectID     string
	BuildID       string
}

// ListRunningContainers returns all containers managed by this system
func ListRunningContainers() []RunningContainer {
	result := ExecDocker(
		"ps", "--format", "{{.Names}} {{.Label \"thakur.projectId\"}} {{.Label \"thakur.buildId\"}}",
		"--filter", "label=thakur.projectId",
	)

	if result.ExitCode != 0 {
		return nil
	}

	var containers []RunningContainer
	lines := strings.Split(strings.TrimSpace(result.Stdout), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 3 {
			containers = append(containers, RunningContainer{
				ContainerName: parts[0],
				ProjectID:     parts[1],
				BuildID:       parts[2],
			})
		}
	}

	return containers
}
