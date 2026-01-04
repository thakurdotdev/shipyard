package services

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/db"
)

type AuthService struct {
	queries *db.Queries
	pool    *pgxpool.Pool
}

func NewAuthService(pool *pgxpool.Pool) *AuthService {
	return &AuthService{
		queries: db.New(pool),
		pool:    pool,
	}
}

// Session represents a validated session with user info
type Session struct {
	ID        string
	UserID    string
	UserName  string
	UserEmail string
	UserImage *string
	ExpiresAt int64
}

// ValidateSession checks if a session token is valid
func (s *AuthService) ValidateSession(ctx context.Context, token string) (*Session, error) {
	if token == "" {
		return nil, fmt.Errorf("no token provided")
	}

	row, err := s.queries.GetSessionByToken(ctx, token)
	if err != nil {
		return nil, fmt.Errorf("invalid session: %w", err)
	}

	var expiresAt int64
	if row.ExpiresAt.Valid {
		expiresAt = row.ExpiresAt.Time.Unix()
	}

	return &Session{
		ID:        row.ID,
		UserID:    row.UserID,
		UserName:  row.Name,
		UserEmail: row.Email,
		UserImage: db.FromPgText(row.Image),
		ExpiresAt: expiresAt,
	}, nil
}

// GetUserByID retrieves a user by ID
func (s *AuthService) GetUserByID(ctx context.Context, id string) (*db.User, error) {
	user, err := s.queries.GetUserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// DeleteSession invalidates a session
func (s *AuthService) DeleteSession(ctx context.Context, token string) error {
	return s.queries.DeleteSession(ctx, token)
}

// CleanupExpiredSessions removes expired sessions
func (s *AuthService) CleanupExpiredSessions(ctx context.Context) error {
	return s.queries.DeleteExpiredSessions(ctx)
}
