package logging

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

type LogLevel string

const (
	LogLevelInfo    LogLevel = "info"
	LogLevelWarning LogLevel = "warning"
	LogLevelError   LogLevel = "error"
	LogLevelSuccess LogLevel = "success"
	LogLevelDeploy  LogLevel = "deploy"
)

var controlAPIURL = "http://localhost:4000"

// SetControlAPIURL sets the control API URL for log streaming
func SetControlAPIURL(url string) {
	controlAPIURL = url
}

// init loads the control API URL from environment
func init() {
	if url := os.Getenv("CONTROL_API_URL"); url != "" {
		controlAPIURL = url
	}
}

// StreamLog sends a log entry to the control API
func StreamLog(buildID, message string, level LogLevel) {
	payload := map[string]string{
		"logs":  fmt.Sprintf("[Deploy] %s\n", message),
		"level": string(level),
	}

	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/builds/%s/logs", controlAPIURL, buildID)

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		fmt.Printf("[Logger] Failed to create request: %v\n", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("[Logger] Failed to stream log: %v\n", err)
		return
	}
	defer resp.Body.Close()
}
