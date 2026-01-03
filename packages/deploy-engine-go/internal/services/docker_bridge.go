package services

import (
	"github.com/thakurdotdev/deploy-engine/internal/services/docker"
)

// DockerServiceInterface defines the Docker service contract
type DockerServiceInterface interface {
	Deploy(projectID, buildID, sourceDir string, hostPort int, appType string, envVars map[string]string) (bool, string, error)
	Stop(projectID, buildID string) bool
	Cleanup(projectID string, buildIDs []string)
	RecoverLogStreams()
	IsRunning(projectID string) bool
	GetLogs(projectID string, tail int) string
}

// GetDockerService returns the Docker service singleton
func GetDockerService() DockerServiceInterface {
	return docker.GetDockerService()
}

// RecoverDockerLogStreams recovers log streams for running containers on startup
func RecoverDockerLogStreams() {
	docker.GetDockerService().RecoverLogStreams()
}

// IsDockerAvailable checks if Docker daemon is running
func IsDockerAvailable() bool {
	return docker.IsDockerAvailable()
}
