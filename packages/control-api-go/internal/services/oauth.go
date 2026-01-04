package services

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/config"
	"github.com/thakurdotdev/control-api/internal/db"
)

type OAuthService struct {
	queries      *db.Queries
	pool         *pgxpool.Pool
	clientID     string
	clientSecret string
	callbackURL  string
}

func NewOAuthService(pool *pgxpool.Pool) *OAuthService {
	cfg := config.Get()
	return &OAuthService{
		queries:      db.New(pool),
		pool:         pool,
		clientID:     cfg.GitHubClientID,
		clientSecret: cfg.GitHubClientSecret,
		callbackURL:  cfg.APIURL + "/auth/callback/github",
	}
}

// GitHubUser represents GitHub user data
type GitHubUser struct {
	ID        int    `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

// GenerateState creates a random state for CSRF protection
func GenerateState() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

// GenerateSessionToken creates a random session token
func GenerateSessionToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

// GetGitHubAuthURL returns the GitHub OAuth authorization URL
func (s *OAuthService) GetGitHubAuthURL(state string) string {
	return fmt.Sprintf(
		"https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&scope=read:user,user:email&state=%s",
		s.clientID,
		s.callbackURL,
		state,
	)
}

// ExchangeCode exchanges the OAuth code for an access token
func (s *OAuthService) ExchangeCode(ctx context.Context, code string) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://github.com/login/oauth/access_token", nil)
	q := req.URL.Query()
	q.Add("client_id", s.clientID)
	q.Add("client_secret", s.clientSecret)
	q.Add("code", code)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.Error != "" {
		return "", fmt.Errorf("OAuth error: %s", result.Error)
	}

	return result.AccessToken, nil
}

// GetGitHubUser fetches user info from GitHub API
func (s *OAuthService) GetGitHubUser(ctx context.Context, accessToken string) (*GitHubUser, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var user GitHubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}

	// Fetch email if not public
	if user.Email == "" {
		user.Email, _ = s.fetchPrimaryEmail(ctx, accessToken)
	}

	return &user, nil
}

func (s *OAuthService) fetchPrimaryEmail(ctx context.Context, accessToken string) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user/emails", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var emails []struct {
		Email   string `json:"email"`
		Primary bool   `json:"primary"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&emails); err != nil {
		return "", err
	}

	for _, e := range emails {
		if e.Primary {
			return e.Email, nil
		}
	}
	if len(emails) > 0 {
		return emails[0].Email, nil
	}
	return "", nil
}

// CreateOrUpdateUser creates or updates a user from GitHub data
func (s *OAuthService) CreateOrUpdateUser(ctx context.Context, ghUser *GitHubUser, accessToken string) (*db.User, error) {
	githubUserID := fmt.Sprintf("github_%d", ghUser.ID)
	now := pgtype.Timestamp{Time: time.Now(), Valid: true}

	// 1. Try to get existing user by ID (already linked)
	user, err := s.queries.GetUserByID(ctx, githubUserID)
	if err == nil {
		return &user, nil
	}

	// 2. Try to get existing user by Email (to link account)
	var finalUserID string
	var existingUser db.User
	// Use raw query for case-insensitive search (LOWER(email) = LOWER($1))
	err = s.pool.QueryRow(ctx, `SELECT id, name, email, email_verified, image, created_at, updated_at FROM "user" WHERE LOWER(email) = LOWER($1)`, ghUser.Email).Scan(
		&existingUser.ID, &existingUser.Name, &existingUser.Email, &existingUser.EmailVerified, &existingUser.Image, &existingUser.CreatedAt, &existingUser.UpdatedAt,
	)
	
	if err == nil {
		// User exists! Link this GitHub account to them
		finalUserID = existingUser.ID
		// Optionally update their name/image if empty? Keeping simple for now
	} else {
		// User does not exist, create new one
		finalUserID = githubUserID
		_, err = s.pool.Exec(ctx, `
			INSERT INTO "user" (id, name, email, email_verified, image, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				image = EXCLUDED.image,
				updated_at = EXCLUDED.updated_at
		`, finalUserID, ghUser.Name, ghUser.Email, true, ghUser.AvatarURL, now.Time, now.Time)
		if err != nil {
			// If we STILL get a duplicate email error here, it means a race condition or mismatch. 
			// Try one last fetch to be safe.
			errRetry := s.pool.QueryRow(ctx, `SELECT id FROM "user" WHERE LOWER(email) = LOWER($1)`, ghUser.Email).Scan(&finalUserID)
			if errRetry == nil {
				// Found it on retry (race condition handled)
			} else {
				return nil, fmt.Errorf("failed to create user: %w", err)
			}
		}
	}

	// 3. Create/Update account link
	accountID := fmt.Sprintf("github_%d", ghUser.ID)
	_, err = s.pool.Exec(ctx, `
		INSERT INTO account (id, account_id, provider_id, user_id, access_token, created_at, updated_at)
		VALUES ($1, $2, 'github', $3, $4, $5, $6)
		ON CONFLICT (id) DO UPDATE SET
			access_token = EXCLUDED.access_token,
			user_id = EXCLUDED.user_id,
			updated_at = EXCLUDED.updated_at
	`, accountID, fmt.Sprintf("%d", ghUser.ID), finalUserID, accessToken, now.Time, now.Time)
	if err != nil {
		return nil, fmt.Errorf("failed to create account: %w", err)
	}

	// Return the user
	user, err = s.queries.GetUserByID(ctx, finalUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get created user: %w", err)
	}
	return &user, nil
}

func (s *OAuthService) CreateSession(ctx context.Context, userID, ipAddress, userAgent string) (string, error) {
	sessionID := GenerateSessionToken()
	token := GenerateSessionToken()
	expiresAt := pgtype.Timestamp{Time: time.Now().Add(30 * 24 * time.Hour), Valid: true} // 30 days

	_, err := s.queries.CreateSession(ctx, db.CreateSessionParams{
		ID:        sessionID,
		ExpiresAt: expiresAt,
		Token:     token,
		IpAddress: pgtype.Text{String: ipAddress, Valid: true},
		UserAgent: pgtype.Text{String: userAgent, Valid: true},
		UserID:    userID,
	})
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}

	return token, nil
}
