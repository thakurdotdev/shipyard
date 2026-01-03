package docker

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type FrameworkType string

const (
	FrameworkNextJS  FrameworkType = "nextjs"
	FrameworkVite    FrameworkType = "vite"
	FrameworkExpress FrameworkType = "express"
	FrameworkHono    FrameworkType = "hono"
	FrameworkElysia  FrameworkType = "elysia"
)

// Common entry file patterns for backend apps
var entryPatterns = []string{
	"src/index.ts", "src/index.js",
	"src/server.ts", "src/server.js",
	"index.ts", "index.js",
	"server.ts", "server.js",
}

// DetectEntryFile finds the entry point for backend apps
func DetectEntryFile(sourceDir string) string {
	for _, pattern := range entryPatterns {
		if fileExists(filepath.Join(sourceDir, pattern)) {
			return pattern
		}
	}
	return ""
}

// HasStartScript checks if package.json has a start script
func HasStartScript(sourceDir string) bool {
	pkgPath := filepath.Join(sourceDir, "package.json")
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return false
	}
	return strings.Contains(string(data), `"start"`)
}

// GenerateDockerfile creates a Dockerfile for the given framework
func GenerateDockerfile(framework FrameworkType, internalPort int, entryFile string) string {
	// Determine CMD based on entry point
	cmd := `CMD ["bun", "run", "start"]`
	if entryFile != "" {
		cmd = fmt.Sprintf(`CMD ["bun", "run", "%s"]`, entryFile)
	}

	switch framework {
	case FrameworkVite:
		// Static sites use nginx:alpine
		return `FROM nginx:alpine
COPY dist/ /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]`

	case FrameworkNextJS:
		return fmt.Sprintf(`FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app .
ENV NODE_ENV=production
ENV PORT=%d
EXPOSE %d
%s`, internalPort, internalPort, cmd)

	default:
		// Backend frameworks (express, hono, elysia)
		return fmt.Sprintf(`FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app .
ENV NODE_ENV=production
ENV PORT=%d
EXPOSE %d
%s`, internalPort, internalPort, cmd)
	}
}

// SanitizeDockerfile ensures security and correct port configuration
func SanitizeDockerfile(content string, internalPort int) string {
	lines := strings.Split(content, "\n")
	hasPortEnv := false
	hasExpose := false

	for i, line := range lines {
		upper := strings.ToUpper(strings.TrimSpace(line))

		// Replace EXPOSE with our port
		if strings.HasPrefix(upper, "EXPOSE ") {
			hasExpose = true
			lines[i] = fmt.Sprintf("EXPOSE %d", internalPort)
		}

		// Fix PORT env var
		if strings.HasPrefix(upper, "ENV ") && strings.Contains(upper, "PORT") {
			hasPortEnv = true
			portRe := regexp.MustCompile(`PORT\s*=?\s*\d+`)
			lines[i] = portRe.ReplaceAllString(line, fmt.Sprintf("PORT=%d", internalPort))
		}

		// Remove dangerous instructions
		if strings.Contains(upper, "USER ROOT") ||
			strings.Contains(upper, "--PRIVILEGED") ||
			strings.Contains(upper, "DOCKER.SOCK") {
			lines[i] = "# REMOVED FOR SECURITY: " + line
		}
	}

	// Add EXPOSE if missing
	if !hasExpose {
		lines = append(lines, fmt.Sprintf("EXPOSE %d", internalPort))
	}

	// Add PORT env if missing (before CMD/ENTRYPOINT)
	if !hasPortEnv {
		cmdIdx := -1
		for i, line := range lines {
			upper := strings.ToUpper(strings.TrimSpace(line))
			if strings.HasPrefix(upper, "CMD") || strings.HasPrefix(upper, "ENTRYPOINT") {
				cmdIdx = i
				break
			}
		}
		portEnv := fmt.Sprintf("ENV PORT=%d", internalPort)
		if cmdIdx > -1 {
			lines = append(lines[:cmdIdx], append([]string{portEnv}, lines[cmdIdx:]...)...)
		} else {
			lines = append(lines, portEnv)
		}
	}

	return strings.Join(lines, "\n")
}

// BuildImage builds a Docker image from source directory
func BuildImage(
	projectID, buildID, sourceDir string,
	framework FrameworkType,
	internalPort int,
	onLog func(string),
) BuildResult {
	imageName := GetImageName(projectID, buildID)
	dockerfilePath := filepath.Join(sourceDir, "Dockerfile")
	generatedDockerfile := false

	// Check source directory exists
	if !fileExists(sourceDir) {
		return BuildResult{
			Success:   false,
			ImageName: imageName,
			Error:     fmt.Sprintf("Source directory not found: %s", sourceDir),
		}
	}

	// Use existing Dockerfile or generate one
	if fileExists(dockerfilePath) {
		content, _ := os.ReadFile(dockerfilePath)
		sanitized := SanitizeDockerfile(string(content), internalPort)
		os.WriteFile(dockerfilePath, []byte(sanitized), 0644)
		onLog("Using existing Dockerfile (sanitized)")
	} else {
		// Detect entry point
		var entryFile string
		if !HasStartScript(sourceDir) {
			entryFile = DetectEntryFile(sourceDir)
			if entryFile != "" {
				onLog(fmt.Sprintf("Detected entry file: %s", entryFile))
			}
		}

		content := GenerateDockerfile(framework, internalPort, entryFile)
		os.WriteFile(dockerfilePath, []byte(content), 0644)
		onLog(fmt.Sprintf("Generated Dockerfile for %s", framework))
		generatedDockerfile = true
	}

	// Build the image
	onLog(fmt.Sprintf("Building Docker image: %s", imageName))
	exitCode, err := ExecDockerWithStream(
		[]string{"build", "-t", imageName, sourceDir},
		onLog,
	)

	// Cleanup generated Dockerfile
	if generatedDockerfile {
		os.Remove(dockerfilePath)
	}

	if exitCode != 0 || err != nil {
		errMsg := "Docker build failed"
		if err != nil {
			errMsg = err.Error()
		}
		return BuildResult{Success: false, ImageName: imageName, Error: errMsg}
	}

	onLog(fmt.Sprintf("Image built successfully: %s", imageName))
	return BuildResult{Success: true, ImageName: imageName}
}

// RemoveImage deletes a Docker image
func RemoveImage(imageName string) bool {
	result := ExecDocker("rmi", "-f", imageName)
	return result.ExitCode == 0
}

// PruneProjectImages keeps only the latest N images for a project
func PruneProjectImages(projectID string, keepCount int) {
	prefix := "thakur-deploy/" + projectID[:min(8, len(projectID))]

	result := ExecDocker(
		"images", "--format", "{{.Repository}}:{{.Tag}} {{.CreatedAt}}",
		"--filter", fmt.Sprintf("reference=%s:*", prefix),
	)

	if result.ExitCode != 0 || result.Stdout == "" {
		return
	}

	type imageInfo struct {
		name string
		date time.Time
	}

	var images []imageInfo
	for _, line := range strings.Split(result.Stdout, "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, " ", 2)
		if len(parts) < 2 {
			continue
		}
		// Parse date (format: 2024-01-01 12:00:00 +0000 UTC)
		t, err := time.Parse("2006-01-02 15:04:05 -0700 MST", parts[1])
		if err != nil {
			continue
		}
		images = append(images, imageInfo{name: parts[0], date: t})
	}

	// Sort by date descending
	sort.Slice(images, func(i, j int) bool {
		return images[i].date.After(images[j].date)
	})

	// Remove old images beyond keepCount
	for i := keepCount; i < len(images); i++ {
		RemoveImage(images[i].name)
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
