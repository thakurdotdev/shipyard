package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/thakurdotdev/build-worker/internal/config"
)

type LogLevel string

const (
	LogLevelInfo    LogLevel = "info"
	LogLevelWarning LogLevel = "warning"
	LogLevelError   LogLevel = "error"
	LogLevelSuccess LogLevel = "success"
)

const flushInterval = 300 * time.Millisecond

type logEntry struct {
	message string
	level   LogLevel
}

// LogStreamer uses channels for non-blocking log writes
type LogStreamer struct {
	buildID   string
	projectID string
	entries   chan logEntry
	done      chan struct{}
	wg        sync.WaitGroup
}

var (
	streamers   = make(map[string]*LogStreamer)
	streamersMu sync.Mutex
)

// GetLogStreamer returns or creates a streamer for a build
func GetLogStreamer(buildID, projectID string) *LogStreamer {
	streamersMu.Lock()
	defer streamersMu.Unlock()

	if s, ok := streamers[buildID]; ok {
		return s
	}

	s := &LogStreamer{
		buildID:   buildID,
		projectID: projectID,
		entries:   make(chan logEntry, 100), // Buffered channel
		done:      make(chan struct{}),
	}

	// Start background flush goroutine
	s.wg.Add(1)
	go s.flushLoop()

	streamers[buildID] = s
	return s
}

// Stream queues a log entry (non-blocking)
func (s *LogStreamer) Stream(message string, level LogLevel) {
	select {
	case s.entries <- logEntry{message: message, level: level}:
	default:
		// Channel full, force flush
		s.flush()
		s.entries <- logEntry{message: message, level: level}
	}
}

// flushLoop runs in background, flushing at intervals
func (s *LogStreamer) flushLoop() {
	defer s.wg.Done()
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.flush()
		case <-s.done:
			s.flush() // Final flush
			return
		}
	}
}

// flush sends buffered entries to control-api
func (s *LogStreamer) flush() {
	// Drain channel
	var entries []logEntry
	for {
		select {
		case e := <-s.entries:
			entries = append(entries, e)
		default:
			goto send
		}
	}

send:
	if len(entries) == 0 {
		return
	}

	// Group by level
	byLevel := make(map[LogLevel]string)
	for _, e := range entries {
		byLevel[e.level] += e.message
	}

	cfg := config.Get()
	client := &http.Client{Timeout: 5 * time.Second}

	for level, logs := range byLevel {
		payload := map[string]string{
			"logs":  logs,
			"level": string(level),
		}
		body, _ := json.Marshal(payload)

		url := fmt.Sprintf("%s/builds/%s/logs", cfg.ControlAPIURL, s.buildID)
		req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			fmt.Printf("[LogStreamer] Failed: %v\n", err)
			continue
		}
		resp.Body.Close()
	}
}

// Close stops the streamer and flushes remaining logs
func (s *LogStreamer) Close() {
	close(s.done)
	s.wg.Wait()

	streamersMu.Lock()
	delete(streamers, s.buildID)
	streamersMu.Unlock()
}

// StreamLog is a convenience function
func StreamLog(buildID, projectID, message string, level LogLevel) {
	s := GetLogStreamer(buildID, projectID)
	s.Stream(message, level)
}

// EnsureFlushed closes and flushes a build's streamer
func EnsureFlushed(buildID string) {
	streamersMu.Lock()
	s, ok := streamers[buildID]
	streamersMu.Unlock()
	if ok {
		s.Close()
	}
}
