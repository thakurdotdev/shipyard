package services

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/db"
)

type ProjectService struct {
	queries *db.Queries
	pool    *pgxpool.Pool
}

func NewProjectService(pool *pgxpool.Pool) *ProjectService {
	return &ProjectService{
		queries: db.New(pool),
		pool:    pool,
	}
}

// CreateProject creates a new project
func (s *ProjectService) CreateProject(ctx context.Context, params db.CreateProjectParams) (*db.Project, error) {
	// Get next available port
	nextPort, err := s.queries.GetNextAvailablePort(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get next port: %w", err)
	}

	params.Port = db.ToPgInt4(nextPort)

	project, err := s.queries.CreateProject(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("failed to create project: %w", err)
	}

	return &project, nil
}

// GetProject retrieves a project by ID
func (s *ProjectService) GetProject(ctx context.Context, id uuid.UUID) (*db.Project, error) {
	project, err := s.queries.GetProjectByID(ctx, db.ToPgUUID(id))
	if err != nil {
		return nil, err
	}
	return &project, nil
}

// ListProjects retrieves all projects
func (s *ProjectService) ListProjects(ctx context.Context) ([]db.Project, error) {
	return s.queries.ListProjects(ctx)
}

// UpdateProject updates a project
func (s *ProjectService) UpdateProject(ctx context.Context, id uuid.UUID, params db.UpdateProjectParams) (*db.Project, error) {
	params.ID = db.ToPgUUID(id)
	project, err := s.queries.UpdateProject(ctx, params)
	if err != nil {
		return nil, err
	}
	return &project, nil
}

// DeleteProject deletes a project and all related data
func (s *ProjectService) DeleteProject(ctx context.Context, id uuid.UUID) error {
	pgID := db.ToPgUUID(id)

	// Use transaction for cascade delete
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	qtx := s.queries.WithTx(tx)

	// Delete in order: deployments, builds, env vars, then project
	if err := qtx.DeleteDeploymentsByProject(ctx, pgID); err != nil {
		return fmt.Errorf("failed to delete deployments: %w", err)
	}

	if err := qtx.DeleteBuildsByProject(ctx, pgID); err != nil {
		return fmt.Errorf("failed to delete builds: %w", err)
	}

	if err := qtx.DeleteEnvVarsByProject(ctx, pgID); err != nil {
		return fmt.Errorf("failed to delete env vars: %w", err)
	}

	if err := qtx.DeleteProject(ctx, pgID); err != nil {
		return fmt.Errorf("failed to delete project: %w", err)
	}

	return tx.Commit(ctx)
}

// GetProjectByGitHubRepo finds a project by GitHub repo and branch
func (s *ProjectService) GetProjectByGitHubRepo(ctx context.Context, repoID, branch string) (*db.Project, error) {
	project, err := s.queries.GetProjectByGitHubRepo(ctx, db.GetProjectByGitHubRepoParams{
		GithubRepoID: db.ToPgText(repoID),
		GithubBranch: db.ToPgText(branch),
	})
	if err != nil {
		return nil, err
	}
	return &project, nil
}
