package docker

import (
	"bufio"
	"bytes"
	"fmt"
	"os/exec"
)

// ExecResult holds the output of a docker command
type ExecResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

// ExecDocker runs a docker command and returns the output
func ExecDocker(args ...string) ExecResult {
	cmd := exec.Command("docker", args...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	return ExecResult{
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		ExitCode: exitCode,
	}
}

// ExecDockerWithStream runs a docker command and streams output in real-time
func ExecDockerWithStream(args []string, onOutput func(string)) (int, error) {
	cmd := exec.Command("docker", args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return 1, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return 1, err
	}

	if err := cmd.Start(); err != nil {
		return 1, err
	}

	// Stream stdout
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			onOutput(scanner.Text())
		}
	}()

	// Stream stderr (docker build outputs progress here)
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			onOutput(scanner.Text())
		}
	}()

	err = cmd.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return 1, err
		}
	}

	return exitCode, nil
}

// IsDockerAvailable checks if Docker daemon is running
func IsDockerAvailable() bool {
	result := ExecDocker("version", "--format", "{{.Server.Version}}")
	return result.ExitCode == 0 && len(result.Stdout) > 0
}

// Log helper for docker operations
func dockerLog(format string, args ...interface{}) {
	fmt.Printf("[Docker] "+format+"\n", args...)
}
