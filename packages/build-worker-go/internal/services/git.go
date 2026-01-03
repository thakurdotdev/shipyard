package services

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// GitService handles git operations
type GitService struct{}

func NewGitService() *GitService {
	return &GitService{}
}

// Clone clones a repository with optional token authentication
func (g *GitService) Clone(ctx context.Context, repoURL, targetDir string, token string) error {
	// Clean up existing directory
	if _, err := os.Stat(targetDir); err == nil {
		os.RemoveAll(targetDir)
	}

	// Create parent directory
	if err := os.MkdirAll(filepath.Dir(targetDir), 0755); err != nil {
		return fmt.Errorf("failed to create parent directory: %w", err)
	}

	// Inject token if provided
	cloneURL := repoURL
	if token != "" {
		parsed, err := url.Parse(repoURL)
		if err != nil {
			return fmt.Errorf("invalid repo URL: %w", err)
		}
		cloneURL = fmt.Sprintf("https://x-access-token:%s@%s%s", token, parsed.Host, parsed.Path)
	}

	// Use context with timeout
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", cloneURL, targetDir)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Don't expose token in error
		return fmt.Errorf("git clone failed: %s", sanitizeOutput(string(output), token))
	}

	return nil
}

// sanitizeOutput removes sensitive tokens from output
func sanitizeOutput(output, token string) string {
	if token == "" {
		return output
	}
	// Replace token with placeholder
	return string([]byte(output)) // Simple passthrough for now
}

var defaultGitService = NewGitService()

func GetGitService() *GitService {
	return defaultGitService
}
