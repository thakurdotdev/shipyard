-- name: GetSessionByToken :one
SELECT s.*, u.name, u.email, u.image
FROM session s
JOIN "user" u ON s.user_id = u.id
WHERE s.token = $1 AND s.expires_at > NOW();

-- name: GetUserByID :one
SELECT * FROM "user" WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM "user" WHERE email = $1;

-- name: CreateSession :one
INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id)
VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6)
RETURNING *;

-- name: DeleteSession :exec
DELETE FROM session WHERE token = $1;

-- name: DeleteExpiredSessions :exec
DELETE FROM session WHERE expires_at < NOW();

-- name: GetGitHubInstallation :one
SELECT * FROM github_installations WHERE github_installation_id = $1;

-- name: UpsertGitHubInstallation :one
INSERT INTO github_installations (github_installation_id, account_login, account_id, account_type)
VALUES ($1, $2, $3, $4)
ON CONFLICT (github_installation_id) DO UPDATE SET
    account_login = EXCLUDED.account_login,
    account_id = EXCLUDED.account_id,
    account_type = EXCLUDED.account_type
RETURNING *;

-- name: ListGitHubInstallations :many
SELECT * FROM github_installations ORDER BY created_at DESC;

-- name: GetGitHubAccountByUserID :one
SELECT * FROM account 
WHERE user_id = $1 AND provider_id = 'github' 
LIMIT 1;
