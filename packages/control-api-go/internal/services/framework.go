package services



type Framework string

const (
	FrameworkNextJS  Framework = "nextjs"
	FrameworkVite    Framework = "vite"
	FrameworkElysia  Framework = "elysia"
	FrameworkHono    Framework = "hono"
	FrameworkExpress Framework = "express"
	FrameworkUnknown Framework = "unknown"
)

type DetectedFramework struct {
	Framework  Framework
	Confidence string
	Reason     string
}

type FrameworkInfo struct {
	Name  string `json:"name"`
	Icon  string `json:"icon"`
	Color string `json:"color"`
}

type FrameworkRule struct {
	Framework    Framework
	ConfigFiles  []string
	Dependencies []string
}

var frameworkRules = []FrameworkRule{
	{
		Framework:    FrameworkNextJS,
		ConfigFiles:  []string{"next.config.js", "next.config.ts", "next.config.mjs"},
		Dependencies: []string{"next"},
	},
	{
		Framework:    FrameworkVite,
		ConfigFiles:  []string{"vite.config.js", "vite.config.ts", "vite.config.mjs"},
		Dependencies: []string{"vite"},
	},
	{
		Framework:    FrameworkElysia,
		ConfigFiles:  []string{},
		Dependencies: []string{"elysia"},
	},
	{
		Framework:    FrameworkHono,
		ConfigFiles:  []string{},
		Dependencies: []string{"hono"},
	},
	{
		Framework:    FrameworkExpress,
		ConfigFiles:  []string{},
		Dependencies: []string{"express"},
	},
}

// DetectFramework identifies the framework based on files and package.json
func DetectFramework(files []string, packageJSON map[string]interface{}) DetectedFramework {
	// Combine dependencies and devDependencies
	allDeps := make(map[string]struct{})
	
	if deps, ok := packageJSON["dependencies"].(map[string]interface{}); ok {
		for k := range deps {
			allDeps[k] = struct{}{}
		}
	}
	if devDeps, ok := packageJSON["devDependencies"].(map[string]interface{}); ok {
		for k := range devDeps {
			allDeps[k] = struct{}{}
		}
	}

	for _, rule := range frameworkRules {
		// Check config files (high confidence)
		for _, configFile := range rule.ConfigFiles {
			for _, file := range files {
				if file == configFile {
					return DetectedFramework{
						Framework:  rule.Framework,
						Confidence: "high",
						Reason:     "Found " + configFile,
					}
				}
			}
		}

		// Check dependencies (medium confidence)
		for _, dep := range rule.Dependencies {
			if _, exists := allDeps[dep]; exists {
				return DetectedFramework{
					Framework:  rule.Framework,
					Confidence: "medium",
					Reason:     "Found dependency: " + dep,
				}
			}
		}
	}

	return DetectedFramework{
		Framework:  FrameworkUnknown,
		Confidence: "low",
		Reason:     "No framework detected",
	}
}

// GetFrameworkDisplayInfo returns UI metadata for a framework
func GetFrameworkDisplayInfo(f Framework) FrameworkInfo {
	switch f {
	case FrameworkNextJS:
		return FrameworkInfo{Name: "Next.js", Icon: "nextjs", Color: "#000000"}
	case FrameworkVite:
		return FrameworkInfo{Name: "Vite", Icon: "vite", Color: "#646CFF"}
	case FrameworkExpress:
		return FrameworkInfo{Name: "Express", Icon: "express", Color: "#000000"}
	case FrameworkHono:
		return FrameworkInfo{Name: "Hono", Icon: "hono", Color: "#E36002"}
	case FrameworkElysia:
		return FrameworkInfo{Name: "Elysia", Icon: "elysia", Color: "#7C3AED"}
	default:
		return FrameworkInfo{Name: "Unknown", Icon: "folder", Color: "#6B7280"}
	}
}

// IsMonorepoDir checks if a directory pattern matches common monorepo structures
func IsMonorepoDir(name string) bool {
	patterns := []string{"packages", "apps", "services", "projects"}
	for _, p := range patterns {
		if name == p {
			return true
		}
	}
	return false
}
