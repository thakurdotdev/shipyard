package services

import (
	"github.com/thakurdotdev/deploy-engine/internal/logging"
)

// Re-export log levels for convenience
type LogLevel = logging.LogLevel

const (
	LogLevelInfo    = logging.LogLevelInfo
	LogLevelWarning = logging.LogLevelWarning
	LogLevelError   = logging.LogLevelError
	LogLevelSuccess = logging.LogLevelSuccess
	LogLevelDeploy  = logging.LogLevelDeploy
)

// StreamLog sends a log entry to the control API
func StreamLog(buildID, message string, level LogLevel) {
	logging.StreamLog(buildID, message, level)
}
