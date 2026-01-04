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
)

type DeploymentService struct {
	queries *db.Queries
	pool    *pgxpool.Pool
}

func NewDeploymentService(pool *pgxpool.Pool) *DeploymentService {
	return &DeploymentService{
		queries: db.New(pool),
		pool:    pool,
	}
}

// CreateDeployment creates a new deployment
func (s *DeploymentService) CreateDeployment(ctx context.Context, projectID, buildID uuid.UUID) (*db.Deployment, error) {
	pgProjectID := db.ToPgUUID(projectID)

	// Deactivate existing deployments first
	if err := s.queries.DeactivateProjectDeployments(ctx, pgProjectID); err != nil {
		return nil, fmt.Errorf("failed to deactivate existing deployments: %w", err)
	}

	deployment, err := s.queries.CreateDeployment(ctx, db.CreateDeploymentParams{
		ProjectID: pgProjectID,
		BuildID:   db.ToPgUUID(buildID),
		Status:    "active",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create deployment: %w", err)
	}

	return &deployment, nil
}

// GetActiveDeployment gets the active deployment for a project
func (s *DeploymentService) GetActiveDeployment(ctx context.Context, projectID uuid.UUID) (*db.Deployment, error) {
	deployment, err := s.queries.GetActiveDeploymentByProject(ctx, db.ToPgUUID(projectID))
	if err != nil {
		return nil, err
	}
	return &deployment, nil
}

// ListDeployments lists all deployments for a project
func (s *DeploymentService) ListDeployments(ctx context.Context, projectID uuid.UUID) ([]db.Deployment, error) {
	return s.queries.ListDeploymentsByProject(ctx, db.ToPgUUID(projectID))
}

// ActivateDeployment activates a build on the deploy engine
func (s *DeploymentService) ActivateDeployment(ctx context.Context, project *db.Project, buildID uuid.UUID, envVars map[string]string) error {
	cfg := config.Get()

	payload := map[string]interface{}{
		"build_id":   buildID.String(),
		"project_id": db.FromPgUUID(project.ID).String(),
		"port":       db.FromPgInt4(project.Port),
		"subdomain":  db.FromPgText(project.Domain),
		"app_type":   project.AppType,
		"env_vars":   envVars,
	}

	body, _ := json.Marshal(payload)

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Post(cfg.DeployEngineURL+"/activate", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to activate deployment: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("deploy engine returned status %d", resp.StatusCode)
	}

	// Create deployment record
	_, err = s.CreateDeployment(ctx, db.FromPgUUID(project.ID), buildID)
	return err
}

// StopDeployment stops a running deployment
func (s *DeploymentService) StopDeployment(ctx context.Context, project *db.Project) error {
	cfg := config.Get()

	payload := map[string]interface{}{
		"project_id": db.FromPgUUID(project.ID).String(),
		"port":       db.FromPgInt4(project.Port),
	}

	body, _ := json.Marshal(payload)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Post(cfg.DeployEngineURL+"/stop", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to stop deployment: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("deploy engine returned status %d", resp.StatusCode)
	}

	// Deactivate deployment record
	return s.queries.DeactivateProjectDeployments(ctx, project.ID)
}
