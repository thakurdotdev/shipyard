package services

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/config"
	"github.com/thakurdotdev/control-api/internal/db"
)

type GitHubService struct {
	queries    *db.Queries
	pool       *pgxpool.Pool
	appID      string
	privateKey *rsa.PrivateKey
}

func NewGitHubService(pool *pgxpool.Pool) (*GitHubService, error) {
	cfg := config.Get()
	if cfg.GitHubAppID == "" {
		return nil, fmt.Errorf("GITHUB_APP_ID not set")
	}

	key, err := loadPrivateKey(cfg.GitHubKeyPath)
	if err != nil {
		return nil, err
	}

	return &GitHubService{
		queries:    db.New(pool),
		pool:       pool,
		appID:      cfg.GitHubAppID,
		privateKey: key,
	}, nil
}

func loadPrivateKey(path string) (*rsa.PrivateKey, error) {
	if path != "" {
		return parseKeyFile(path)
	}

	// Search common locations
	commonPaths := []string{
		"github-app.pem",
		"../github-app.pem",
		"../../github-app.pem",
	}

	if cwd, err := os.Getwd(); err == nil {
		commonPaths = append([]string{
			filepath.Join(cwd, "github-app.pem"),
			filepath.Join(cwd, "..", "..", "github-app.pem"),
		}, commonPaths...)
	}

	for _, p := range commonPaths {
		if _, err := os.Stat(p); err == nil {
			fmt.Printf("[GitHub] Found private key at: %s\n", p)
			return parseKeyFile(p)
		}
	}

	return nil, fmt.Errorf("GitHub App private key not found")
}

func parseKeyFile(path string) (*rsa.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block")
	}

	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}

	keyInterface, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	rsaKey, ok := keyInterface.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("key is not RSA")
	}

	return rsaKey, nil
}

	// GenerateAppJWT creates a JWT for GitHub App auth
func (s *GitHubService) GenerateAppJWT() (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iat": now.Add(-60 * time.Second).Unix(),
		"exp": now.Add(10 * time.Minute).Unix(),
		"iss": s.appID,
	}
	
	fmt.Printf("[GitHub] Generating JWT for App ID: %s\n", s.appID)

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(s.privateKey)
}

// GetInstallationToken exchanges JWT for installation access token
func (s *GitHubService) GetInstallationToken(installationID string) (string, error) {
	if installationID == "" {
		return "", fmt.Errorf("installation ID required")
	}

	appJWT, err := s.GenerateAppJWT()
	if err != nil {
		return "", fmt.Errorf("failed to generate JWT: %w", err)
	}

	url := fmt.Sprintf("https://api.github.com/app/installations/%s/access_tokens", installationID)
	req, _ := http.NewRequest("POST", url, nil)
	req.Header.Set("Authorization", "Bearer "+appJWT)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("GitHub API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	var result struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	return result.Token, nil
}

// SaveInstallation saves or updates a GitHub installation
func (s *GitHubService) SaveInstallation(ctx context.Context, installationID, accountLogin, accountID, accountType string) error {
	_, err := s.queries.UpsertGitHubInstallation(ctx, db.UpsertGitHubInstallationParams{
		GithubInstallationID: installationID,
		AccountLogin:         accountLogin,
		AccountID:            accountID,
		AccountType:          accountType,
	})
	return err
}

// GetInstallation retrieves a GitHub installation
func (s *GitHubService) GetInstallation(ctx context.Context, installationID string) (*db.GithubInstallation, error) {
	installation, err := s.queries.GetGitHubInstallation(ctx, installationID)
	if err != nil {
		return nil, err
	}
	return &installation, nil
}

// ListInstallations lists all GitHub installations
func (s *GitHubService) ListInstallations(ctx context.Context) ([]db.GithubInstallation, error) {
	return s.queries.ListGitHubInstallations(ctx)
}

// SyncInstallations fetches installations from GitHub and updates local DB
func (s *GitHubService) SyncInstallations(ctx context.Context, userID string) error {
	// 1. Get User's GitHub Token
	var accessToken string
	err := s.pool.QueryRow(ctx, `
		SELECT access_token FROM account 
		WHERE user_id = $1 AND provider_id = 'github' 
		LIMIT 1
	`, userID).Scan(&accessToken)
	
	if err != nil {
		return fmt.Errorf("no linked GitHub account: %w", err)
	}

	// 2. Fetch from GitHub
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user/installations", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch installations: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	var result struct {
		Installations []struct {
			ID      int64 `json:"id"`
			Account struct {
				Login string `json:"login"`
				ID    int64  `json:"id"`
				Type  string `json:"type"`
			} `json:"account"`
		} `json:"installations"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	// 3. Update DB
	for _, inst := range result.Installations {
		err := s.SaveInstallation(ctx, 
			fmt.Sprintf("%d", inst.ID), 
			inst.Account.Login, 
			fmt.Sprintf("%d", inst.Account.ID), 
			inst.Account.Type,
		)
		if err != nil {
			fmt.Printf("[GitHub] Warning: Failed to save installation %d: %v\n", inst.ID, err)
		}
	}

	return nil
}

// FetchUserRepos fetches repositories from GitHub API
func (s *GitHubService) FetchUserRepos(ctx context.Context, installationID string) ([]map[string]interface{}, error) {
	token, err := s.GetInstallationToken(installationID)
	if err != nil {
		return nil, err
	}

	req, _ := http.NewRequest("GET", "https://api.github.com/installation/repositories", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Repositories []map[string]interface{} `json:"repositories"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.Repositories, nil
}

// FetchRepoContents fetches contents of a path in a repository
func (s *GitHubService) FetchRepoContents(ctx context.Context, installationID, owner, repo, path string) ([]map[string]interface{}, error) {
	token, err := s.GetInstallationToken(installationID)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/%s", owner, repo, path)
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	// Determine if response is array (dir) or object (file)
	// We expect directory listing for this method usually
	var result []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		// If it's a file, it returns an object, which might fail decoding into slice
		// But detectFramework mainly lists directories.
		return nil, fmt.Errorf("failed to parse contents (might be a file?): %w", err)
	}

	return result, nil
}

// FetchFileContent fetches raw content of a file
func (s *GitHubService) FetchFileContent(ctx context.Context, installationID, owner, repo, path string) (map[string]interface{}, error) {
	token, err := s.GetInstallationToken(installationID)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/%s", owner, repo, path)
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3.raw+json") // Get Raw JSON if possible, or raw content

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API error: %s", resp.Status)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse file content: %w", err)
	}

	return result, nil
}
