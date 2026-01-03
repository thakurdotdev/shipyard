package services

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/thakurdotdev/build-worker/internal/config"
)

// ArtifactService handles artifact creation and streaming
type ArtifactService struct{}

func NewArtifactService() *ArtifactService {
	return &ArtifactService{}
}

// StreamArtifact creates a tar.gz and streams it directly to deploy-engine
func (a *ArtifactService) StreamArtifact(buildID, projectDir, appType string) error {
	cfg := config.Get()
	url := fmt.Sprintf("%s/artifacts/upload?buildId=%s", cfg.DeployEngineURL, buildID)

	// Determine files to include
	paths, err := a.getArtifactPaths(projectDir, appType)
	if err != nil {
		return err
	}

	if len(paths) == 0 {
		return fmt.Errorf("no build output found to package")
	}

	fmt.Printf("[Artifact] Packaging: %v\n", paths)

	// Use io.Pipe for zero-copy streaming
	pr, pw := io.Pipe()

	// Start tar creation in goroutine
	go func() {
		defer pw.Close()

		gw := gzip.NewWriter(pw)
		defer gw.Close()

		tw := tar.NewWriter(gw)
		defer tw.Close()

		for _, path := range paths {
			fullPath := filepath.Join(projectDir, path)
			if err := a.addToTar(tw, projectDir, fullPath); err != nil {
				fmt.Printf("[Artifact] Error adding %s: %v\n", path, err)
			}
		}
	}()

	// Upload while tar is being created
	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Post(url, "application/gzip", pr)
	if err != nil {
		return fmt.Errorf("upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upload failed: %s", resp.Status)
	}

	fmt.Println("[Artifact] Upload completed successfully")
	return nil
}

// addToTar adds a file or directory to the tar archive
func (a *ArtifactService) addToTar(tw *tar.Writer, basePath, path string) error {
	return filepath.Walk(path, func(file string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip node_modules and .git
		if fi.IsDir() && (fi.Name() == "node_modules" || fi.Name() == ".git") {
			return filepath.SkipDir
		}

		// Create tar header
		header, err := tar.FileInfoHeader(fi, "")
		if err != nil {
			return err
		}

		// Make path relative to base
		relPath, _ := filepath.Rel(basePath, file)
		header.Name = relPath

		if err := tw.WriteHeader(header); err != nil {
			return err
		}

		// Write file content if not a directory
		if !fi.IsDir() {
			f, err := os.Open(file)
			if err != nil {
				return err
			}
			defer f.Close()

			_, err = io.Copy(tw, f)
			return err
		}

		return nil
	})
}

// getArtifactPaths determines which files to include based on app type
func (a *ArtifactService) getArtifactPaths(projectDir, appType string) ([]string, error) {
	var paths []string

	isBackend := appType == "express" || appType == "hono" || appType == "elysia"

	if isBackend {
		// Backend: include everything except node_modules/.git
		entries, err := os.ReadDir(projectDir)
		if err != nil {
			return nil, err
		}
		for _, e := range entries {
			name := e.Name()
			if name != "node_modules" && name != ".git" {
				paths = append(paths, name)
			}
		}
	} else {
		// Frontend: use specific paths based on framework
		frameworkPaths := map[string][]string{
			"nextjs": {".next", "public", "package.json", "next.config.mjs", "next.config.js", "next.config.ts", "out"},
			"vite":   {"dist"},
		}

		candidates := frameworkPaths[appType]
		if candidates == nil {
			candidates = []string{"dist", "build", "out"}
		}

		// Always include package.json and lockfiles
		for _, f := range []string{"package.json", "bun.lockb", "package-lock.json"} {
			if fileExists(filepath.Join(projectDir, f)) {
				paths = append(paths, f)
			}
		}

		for _, p := range candidates {
			if fileExists(filepath.Join(projectDir, p)) {
				paths = append(paths, p)
			}
		}
	}

	return paths, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

var defaultArtifactService = NewArtifactService()

func GetArtifactService() *ArtifactService {
	return defaultArtifactService
}

// isBackendFramework checks if the app type is a backend framework
func isBackendFramework(appType string) bool {
	return appType == "express" || appType == "hono" || appType == "elysia"
}
