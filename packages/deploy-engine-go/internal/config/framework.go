package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type AppType string

const (
	AppTypeNextJS  AppType = "nextjs"
	AppTypeVite    AppType = "vite"
	AppTypeExpress AppType = "express"
	AppTypeHono    AppType = "hono"
	AppTypeElysia  AppType = "elysia"
)

type FrameworkConfig struct {
	ID              AppType
	DisplayName     string
	Category        string // "frontend" or "backend"
	RequiresInstall bool
	IsStaticBuild   func(cwd string) bool
	StartCommand    func(port int, cwd string) []string
}

var Frameworks = map[AppType]FrameworkConfig{
	AppTypeNextJS: {
		ID:              AppTypeNextJS,
		DisplayName:     "Next.js",
		Category:        "frontend",
		RequiresInstall: true,
		IsStaticBuild: func(cwd string) bool {
			_, err := os.Stat(filepath.Join(cwd, "out"))
			return err == nil
		},
		StartCommand: func(port int, _ string) []string {
			return []string{"bun", "run", "start", "--", "--port", strconv.Itoa(port)}
		},
	},
	AppTypeVite: {
		ID:              AppTypeVite,
		DisplayName:     "Vite",
		Category:        "frontend",
		RequiresInstall: false,
		IsStaticBuild:   func(_ string) bool { return true },
		StartCommand:    func(_ int, _ string) []string { return nil },
	},
	AppTypeExpress: {
		ID:              AppTypeExpress,
		DisplayName:     "Express",
		Category:        "backend",
		RequiresInstall: true,
		IsStaticBuild:   func(_ string) bool { return false },
		StartCommand:    func(_ int, _ string) []string { return []string{"bun", "run", "--bun", "start"} },
	},
	AppTypeHono: {
		ID:              AppTypeHono,
		DisplayName:     "Hono",
		Category:        "backend",
		RequiresInstall: true,
		IsStaticBuild:   func(_ string) bool { return false },
		StartCommand:    func(_ int, _ string) []string { return []string{"bun", "run", "--bun", "start"} },
	},
	AppTypeElysia: {
		ID:              AppTypeElysia,
		DisplayName:     "Elysia",
		Category:        "backend",
		RequiresInstall: true,
		IsStaticBuild:   func(_ string) bool { return false },
		StartCommand:    func(_ int, _ string) []string { return []string{"bun", "run", "--bun", "start"} },
	},
}

var AppTypes = []AppType{AppTypeNextJS, AppTypeVite, AppTypeExpress, AppTypeHono, AppTypeElysia}

func IsValidAppType(t string) bool {
	_, ok := Frameworks[AppType(t)]
	return ok
}

func IsBackendFramework(t AppType) bool {
	if fw, ok := Frameworks[t]; ok {
		return fw.Category == "backend"
	}
	return false
}

func ShouldUseStaticServer(appType AppType, cwd string) bool {
	if fw, ok := Frameworks[appType]; ok {
		return fw.IsStaticBuild(cwd)
	}
	return false
}

func DetectEntryFile(cwd string) string {
	pkgPath := filepath.Join(cwd, "package.json")
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return findCommonEntry(cwd)
	}

	var pkg struct {
		Main    string            `json:"main"`
		Scripts map[string]string `json:"scripts"`
	}
	if json.Unmarshal(data, &pkg) != nil {
		return findCommonEntry(cwd)
	}

	// Priority 1: dev script (most reliable for TypeScript source)
	if script, ok := pkg.Scripts["dev"]; ok {
		if entry := extractEntryFromScript(script); entry != "" {
			if fileExists(filepath.Join(cwd, entry)) {
				return entry
			}
		}
	}

	// Priority 2: main field
	if pkg.Main != "" && fileExists(filepath.Join(cwd, pkg.Main)) {
		return pkg.Main
	}

	// Priority 3: if main points to dist/, try source equivalent
	if strings.Contains(pkg.Main, "dist/") {
		srcEntry := strings.Replace(pkg.Main, "dist/", "src/", 1)
		srcEntry = strings.Replace(srcEntry, ".js", ".ts", 1)
		if fileExists(filepath.Join(cwd, srcEntry)) {
			return srcEntry
		}
	}

	// Priority 4: start script
	if script, ok := pkg.Scripts["start"]; ok {
		if entry := extractEntryFromScript(script); entry != "" {
			if fileExists(filepath.Join(cwd, entry)) {
				return entry
			}
		}
	}

	return findCommonEntry(cwd)
}

func GetBackendStartCommand(cwd string) []string {
	if entry := DetectEntryFile(cwd); entry != "" {
		return []string{"bun", "run", entry}
	}
	return []string{"bun", "run", "start"}
}

var entryPattern = regexp.MustCompile(`(?:bun|node|tsx|ts-node|nodemon)\s+(?:run\s+)?(?:watch\s+)?(\S+\.(?:ts|js))`)

func extractEntryFromScript(script string) string {
	matches := entryPattern.FindStringSubmatch(script)
	if len(matches) > 1 {
		return strings.TrimPrefix(matches[1], "./")
	}
	return ""
}

func findCommonEntry(cwd string) string {
	entries := []string{
		"src/index.ts", "src/index.js",
		"src/server.ts", "src/server.js",
		"index.ts", "index.js",
		"server.ts", "server.js",
		"src/app.ts", "src/app.js",
	}
	for _, entry := range entries {
		if fileExists(filepath.Join(cwd, entry)) {
			return entry
		}
	}
	return ""
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
