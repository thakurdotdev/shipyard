package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/config"
	"github.com/thakurdotdev/control-api/internal/db"
	"github.com/thakurdotdev/control-api/internal/sse"
)

type BuildService struct {
	queries     *db.Queries
	pool        *pgxpool.Pool
	broadcaster *sse.Broadcaster
}

func NewBuildService(pool *pgxpool.Pool) *BuildService {
	return &BuildService{
		queries:     db.New(pool),
		pool:        pool,
		broadcaster: sse.GetBroadcaster(),
	}
}

// CreateBuild creates a new build record
func (s *BuildService) CreateBuild(ctx context.Context, projectID uuid.UUID, commitSHA, commitMessage *string) (*db.Build, error) {
	build, err := s.queries.CreateBuild(ctx, db.CreateBuildParams{
		ProjectID:     db.ToPgUUID(projectID),
		Status:        "pending",
		CommitSha:     db.ToPgTextPtr(commitSHA),
		CommitMessage: db.ToPgTextPtr(commitMessage),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create build: %w", err)
	}
	return &build, nil
}

// GetBuild retrieves a build by ID
func (s *BuildService) GetBuild(ctx context.Context, id uuid.UUID) (*db.Build, error) {
	build, err := s.queries.GetBuildByID(ctx, db.ToPgUUID(id))
	if err != nil {
		return nil, err
	}
	return &build, nil
}

// ListBuildsByProject retrieves builds for a project
func (s *BuildService) ListBuildsByProject(ctx context.Context, projectID uuid.UUID, limit int32) ([]db.Build, error) {
	return s.queries.ListBuildsByProject(ctx, db.ListBuildsByProjectParams{
		ProjectID: db.ToPgUUID(projectID),
		Limit:     limit,
	})
}

// UpdateBuildStatus updates a build's status
func (s *BuildService) UpdateBuildStatus(ctx context.Context, id uuid.UUID, status string) (*db.Build, error) {
	build, err := s.queries.UpdateBuildStatus(ctx, db.UpdateBuildStatusParams{
		ID:     db.ToPgUUID(id),
		Status: status,
	})
	if err != nil {
		return nil, err
	}

	// Broadcast status update via SSE
	s.broadcaster.Broadcast(id.String(), fmt.Sprintf("Status: %s", status), "info")

	return &build, nil
}

// TriggerBuildWorker sends build request to build worker
func (s *BuildService) TriggerBuildWorker(ctx context.Context, project *db.Project, build *db.Build, envVars map[string]string) error {
	cfg := config.Get()

	payload := map[string]interface{}{
		"build_id":        db.FromPgUUID(build.ID).String(),
		"project_id":      db.FromPgUUID(project.ID).String(),
		"github_url":      project.GithubUrl,
		"build_command":   project.BuildCommand,
		"root_directory":  db.FromPgText(project.RootDirectory),
		"app_type":        project.AppType,
		"env_vars":        envVars,
		"installation_id": db.FromPgText(project.GithubInstallationID),
	}

	body, _ := json.Marshal(payload)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(cfg.BuildWorkerURL+"/build", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to trigger build worker: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("build worker returned status %d", resp.StatusCode)
	}

	return nil
}

// AppendBuildLog adds a log entry and broadcasts via SSE
func (s *BuildService) AppendBuildLog(ctx context.Context, buildID uuid.UUID, message, level string) error {
	_, err := s.queries.CreateBuildLog(ctx, db.CreateBuildLogParams{
		BuildID: db.ToPgUUID(buildID),
		Level:   level,
		Message: message,
	})
	if err != nil {
		return err
	}

	// Broadcast via SSE
	s.broadcaster.Broadcast(buildID.String(), message, level)

	return nil
}

// GetBuildLogs retrieves logs for a build
func (s *BuildService) GetBuildLogs(ctx context.Context, buildID uuid.UUID) ([]db.BuildLog, error) {
	return s.queries.GetBuildLogsByBuild(ctx, db.ToPgUUID(buildID))
}

// ClearBuildLogs deletes all logs for a build
func (s *BuildService) ClearBuildLogs(ctx context.Context, buildID uuid.UUID) error {
	return s.queries.DeleteBuildLogsByBuild(ctx, db.ToPgUUID(buildID))
}

// CheckDuplicateBuild checks if a build with the same commit already exists
func (s *BuildService) CheckDuplicateBuild(ctx context.Context, projectID uuid.UUID, commitSHA string) (*db.Build, error) {
	build, err := s.queries.GetBuildByCommitSHA(ctx, db.GetBuildByCommitSHAParams{
		ProjectID: db.ToPgUUID(projectID),
		CommitSha: db.ToPgText(commitSHA),
	})
	if err != nil {
		return nil, err
	}
	return &build, nil
}
