package utils

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/thakurdotdev/build-worker/internal/config"
)

// CommandResult holds the result of a command execution
type CommandResult struct {
	ExitCode int
	Error    error
}

// RunCommand executes a command with streaming output
func RunCommand(ctx context.Context, command, cwd string, envVars map[string]string, onOutput func(string)) CommandResult {
	// Convert to bun command
	bunCmd := convertToBunCommand(command)
	
	// Parse command
	parts := strings.Fields(bunCmd)
	if len(parts) == 0 {
		return CommandResult{ExitCode: 1, Error: fmt.Errorf("empty command")}
	}

	// Use context with timeout
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	// Handle "bun" commands
	cfg := config.Get()
	cmdName := parts[0]
	if cmdName == "bun" {
		cmdName = cfg.BunPath
	}

	cmd := exec.CommandContext(ctx, cmdName, parts[1:]...)
	cmd.Dir = cwd
	cmd.Env = os.Environ()
	for k, v := range envVars {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	// Capture output with pipes
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		return CommandResult{ExitCode: 1, Error: err}
	}

	// Stream stdout
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			onOutput(scanner.Text() + "\n")
		}
	}()

	// Stream stderr
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			onOutput(scanner.Text() + "\n")
		}
	}()

	err := cmd.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	return CommandResult{ExitCode: exitCode, Error: err}
}

// convertToBunCommand converts npm/yarn/pnpm commands to bun
func convertToBunCommand(command string) string {
	parts := strings.Split(command, "&&")
	var converted []string

	for _, part := range parts {
		part = strings.TrimSpace(part)

		// npm install -> bun install
		if strings.HasPrefix(part, "npm install") || strings.HasPrefix(part, "npm i ") {
			part = strings.Replace(part, "npm install", "bun install", 1)
			part = strings.Replace(part, "npm i ", "bun install ", 1)
		}

		// npm run -> bun run
		if strings.HasPrefix(part, "npm run") {
			part = strings.Replace(part, "npm run", "bun run", 1)
		}

		// npm ci -> bun install
		if strings.HasPrefix(part, "npm ci") {
			part = strings.Replace(part, "npm ci", "bun install", 1)
		}

		// yarn install -> bun install
		if strings.HasPrefix(part, "yarn install") || part == "yarn" {
			part = "bun install"
		}

		// yarn <script> -> bun run <script>
		if strings.HasPrefix(part, "yarn ") && !strings.HasPrefix(part, "yarn add") && !strings.HasPrefix(part, "yarn remove") {
			part = strings.Replace(part, "yarn ", "bun run ", 1)
		}

		// pnpm install -> bun install
		if strings.HasPrefix(part, "pnpm install") || strings.HasPrefix(part, "pnpm i ") {
			part = strings.Replace(part, "pnpm install", "bun install", 1)
			part = strings.Replace(part, "pnpm i ", "bun install ", 1)
		}

		// pnpm run -> bun run
		if strings.HasPrefix(part, "pnpm run") {
			part = strings.Replace(part, "pnpm run", "bun run", 1)
		}

		converted = append(converted, part)
	}

	return strings.Join(converted, " && ")
}

// NeedsCompilationStep checks if the build command does real compilation
func NeedsCompilationStep(buildCommand string) bool {
	cmd := strings.ToLower(strings.TrimSpace(buildCommand))

	// Skip if just dependency installation
	skipCommands := []string{"npm install", "yarn install", "bun install", "pnpm install", "npm ci", ""}
	for _, skip := range skipCommands {
		if cmd == skip {
			return false
		}
	}

	// Detect compilation patterns
	compilationPatterns := []string{
		"tsc", "esbuild", "swc", "rollup", "webpack",
		"parcel", "vite build", "next build", "tsup", "unbuild", "ncc",
	}

	for _, pattern := range compilationPatterns {
		if strings.Contains(cmd, pattern) {
			return true
		}
	}

	// Check for npm/bun run build patterns
	if strings.Contains(cmd, " run build") {
		return true
	}

	return false
}

// HasScript checks if package.json has a specific script
func HasScript(projectDir, scriptName string) bool {
	pkgPath := projectDir + "/package.json"
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return false
	}
	// Simple check - look for "scriptName":
	return strings.Contains(string(data), fmt.Sprintf(`"%s"`, scriptName))
}
