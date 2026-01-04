package services

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/config"
	"github.com/thakurdotdev/control-api/internal/db"
)

type EnvService struct {
	queries *db.Queries
	pool    *pgxpool.Pool
	key     []byte
}

type EnvVar struct {
	ID        uuid.UUID `json:"id"`
	ProjectID uuid.UUID `json:"project_id"`
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	CreatedAt string    `json:"created_at"`
	UpdatedAt string    `json:"updated_at"`
}

func NewEnvService(pool *pgxpool.Pool) (*EnvService, error) {
	cfg := config.Get()
	key := []byte(cfg.EncryptionKey)

	// Ensure key is 32 bytes for AES-256
	if len(key) < 32 {
		padded := make([]byte, 32)
		copy(padded, key)
		key = padded
	} else if len(key) > 32 {
		key = key[:32]
	}

	return &EnvService{
		queries: db.New(pool),
		pool:    pool,
		key:     key,
	}, nil
}

// encrypt encrypts plaintext using AES-GCM
func (s *EnvService) encrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// decrypt decrypts ciphertext using AES-GCM
func (s *EnvService) decrypt(ciphertext string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertextBytes := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertextBytes, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

// SetEnvVar sets an environment variable (encrypted)
func (s *EnvService) SetEnvVar(ctx context.Context, projectID uuid.UUID, key, value string) error {
	encrypted, err := s.encrypt(value)
	if err != nil {
		return fmt.Errorf("failed to encrypt value: %w", err)
	}

	_, err = s.queries.UpsertEnvVar(ctx, db.UpsertEnvVarParams{
		ProjectID: db.ToPgUUID(projectID),
		Key:       key,
		Value:     encrypted,
	})
	return err
}

// GetEnvVars retrieves all env vars for a project (decrypted)
func (s *EnvService) GetEnvVars(ctx context.Context, projectID uuid.UUID) (map[string]string, error) {
	vars, err := s.queries.GetEnvVarsByProject(ctx, db.ToPgUUID(projectID))
	if err != nil {
		return nil, err
	}

	result := make(map[string]string, len(vars))
	for _, v := range vars {
		decrypted, err := s.decrypt(v.Value)
		if err != nil {
			result[v.Key] = "***"
			continue
		}
		result[v.Key] = decrypted
	}

	return result, nil
}

// GetEnvVarsAsArray retrieves env vars as array (matching TS API format)
func (s *EnvService) GetEnvVarsAsArray(ctx context.Context, projectID uuid.UUID) ([]EnvVar, error) {
	vars, err := s.queries.GetEnvVarsByProject(ctx, db.ToPgUUID(projectID))
	if err != nil {
		return nil, err
	}

	result := make([]EnvVar, len(vars))
	for i, v := range vars {
		decrypted, err := s.decrypt(v.Value)
		if err != nil {
			decrypted = "***"
		}

		result[i] = EnvVar{
			ID:        db.FromPgUUID(v.ID),
			ProjectID: db.FromPgUUID(v.ProjectID),
			Key:       v.Key,
			Value:     decrypted,
			CreatedAt: v.CreatedAt.Time.Format("2006-01-02T15:04:05.000Z"),
			UpdatedAt: v.UpdatedAt.Time.Format("2006-01-02T15:04:05.000Z"),
		}
	}

	return result, nil
}

// GetEnvVarsForBuild retrieves env vars for build (decrypted, for internal use)
func (s *EnvService) GetEnvVarsForBuild(ctx context.Context, projectID uuid.UUID) (map[string]string, error) {
	return s.GetEnvVars(ctx, projectID)
}

// DeleteEnvVar deletes an environment variable
func (s *EnvService) DeleteEnvVar(ctx context.Context, projectID uuid.UUID, key string) error {
	return s.queries.DeleteEnvVar(ctx, db.DeleteEnvVarParams{
		ProjectID: db.ToPgUUID(projectID),
		Key:       key,
	})
}

// GetEnvVarsMasked returns env vars with values masked
func (s *EnvService) GetEnvVarsMasked(ctx context.Context, projectID uuid.UUID) ([]map[string]string, error) {
	vars, err := s.queries.GetEnvVarsByProject(ctx, db.ToPgUUID(projectID))
	if err != nil {
		return nil, err
	}

	result := make([]map[string]string, len(vars))
	for i, v := range vars {
		result[i] = map[string]string{
			"key":   v.Key,
			"value": "••••••••",
		}
	}

	return result, nil
}
