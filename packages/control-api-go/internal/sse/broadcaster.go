package sse

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// EventType distinguishes between different event types
type EventType string

const (
	EventTypeBuildLog         EventType = "build_log"
	EventTypeBuildUpdated     EventType = "build_updated"
	EventTypeDeploymentUpdated EventType = "deployment_updated"
)

// Event represents an SSE event
type Event struct {
	Type    EventType
	RoomID  string // buildID or projectID
	Data    interface{}
	Level   string
}

// Client represents a connected SSE client
type Client struct {
	ID      string
	RoomID  string
	Events  chan Event
	Done    chan struct{}
}

// Broadcaster manages SSE connections and event broadcasting
type Broadcaster struct {
	// rooms: key is "build:{id}" or "project:{id}"
	rooms      map[string]map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan Event
	mu         sync.RWMutex
}

var defaultBroadcaster *Broadcaster
var once sync.Once

// GetBroadcaster returns the singleton broadcaster
func GetBroadcaster() *Broadcaster {
	once.Do(func() {
		defaultBroadcaster = &Broadcaster{
			rooms:      make(map[string]map[*Client]bool),
			register:   make(chan *Client),
			unregister: make(chan *Client),
			broadcast:  make(chan Event, 100),
		}
		go defaultBroadcaster.run()
	})
	return defaultBroadcaster
}

func (b *Broadcaster) run() {
	for {
		select {
		case client := <-b.register:
			b.mu.Lock()
			if b.rooms[client.RoomID] == nil {
				b.rooms[client.RoomID] = make(map[*Client]bool)
			}
			b.rooms[client.RoomID][client] = true
			b.mu.Unlock()
			fmt.Printf("[SSE] Client %s joined room %s\n", client.ID, client.RoomID)

		case client := <-b.unregister:
			b.mu.Lock()
			if clients, ok := b.rooms[client.RoomID]; ok {
				delete(clients, client)
				close(client.Events)
				if len(clients) == 0 {
					delete(b.rooms, client.RoomID)
				}
			}
			b.mu.Unlock()
			fmt.Printf("[SSE] Client %s left room %s\n", client.ID, client.RoomID)

		case event := <-b.broadcast:
			b.mu.RLock()
			if clients, ok := b.rooms[event.RoomID]; ok {
				for client := range clients {
					select {
					case client.Events <- event:
					default:
						// Client buffer full, skip
					}
				}
			}
			b.mu.RUnlock()
		}
	}
}

func (b *Broadcaster) subscribe(roomID, clientID string) *Client {
	client := &Client{
		ID:     clientID,
		RoomID: roomID,
		Events: make(chan Event, 50),
		Done:   make(chan struct{}),
	}
	b.register <- client
	return client
}

func (b *Broadcaster) unsubscribe(client *Client) {
	b.unregister <- client
}

// Broadcast sends a build log event
func (b *Broadcaster) Broadcast(buildID, data, level string) {
	roomID := "build:" + buildID
	b.broadcast <- Event{
		Type:   EventTypeBuildLog,
		RoomID: roomID,
		Data:   data,
		Level:  level,
	}
}

// BroadcastBuildUpdate sends build status update to project subscribers
func (b *Broadcaster) BroadcastBuildUpdate(projectID string, build interface{}) {
	roomID := "project:" + projectID
	b.broadcast <- Event{
		Type:   EventTypeBuildUpdated,
		RoomID: roomID,
		Data:   build,
	}
}

// BroadcastDeploymentUpdate sends deployment update to project subscribers
func (b *Broadcaster) BroadcastDeploymentUpdate(projectID string) {
	roomID := "project:" + projectID
	b.broadcast <- Event{
		Type:   EventTypeDeploymentUpdated,
		RoomID: roomID,
		Data:   map[string]string{"status": "updated"},
	}
}

// ServeBuildLogs handles SSE for build log streaming
func (b *Broadcaster) ServeHTTP(w http.ResponseWriter, r *http.Request, buildID string) {
	b.serveSSE(w, r, "build:"+buildID, "build_log")
}

// ServeProjectUpdates handles SSE for project update streaming
func (b *Broadcaster) ServeProjectSSE(w http.ResponseWriter, r *http.Request, projectID string) {
	b.serveSSE(w, r, "project:"+projectID, "project")
}

func (b *Broadcaster) serveSSE(w http.ResponseWriter, r *http.Request, roomID, eventPrefix string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	clientID := r.RemoteAddr
	client := b.subscribe(roomID, clientID)
	defer b.unsubscribe(client)

	// Send connected event
	fmt.Fprintf(w, "event: connected\ndata: {\"room\":\"%s\"}\n\n", roomID)
	flusher.Flush()

	for {
		select {
		case event, ok := <-client.Events:
			if !ok {
				return
			}

			var data []byte
			switch v := event.Data.(type) {
			case string:
				data = []byte(fmt.Sprintf(`{"data":%q,"level":"%s"}`, v, event.Level))
			default:
				data, _ = json.Marshal(event.Data)
			}

			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data)
			flusher.Flush()

		case <-r.Context().Done():
			return
		}
	}
}

// ClientCount returns number of active clients in a room
func (b *Broadcaster) ClientCount(roomID string) int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if clients, ok := b.rooms[roomID]; ok {
		return len(clients)
	}
	return 0
}
