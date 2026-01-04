-- name: GetProjectByID :one
SELECT * FROM projects WHERE id = $1;

-- name: GetProjectByDomain :one
SELECT * FROM projects WHERE domain = $1;

-- name: GetProjectByPort :one
SELECT * FROM projects WHERE port = $1;

-- name: GetProjectByGitHubRepo :one
SELECT * FROM projects 
WHERE github_repo_id = $1 AND github_branch = $2 
LIMIT 1;

-- name: ListProjects :many
SELECT * FROM projects ORDER BY created_at DESC;

-- name: CreateProject :one
INSERT INTO projects (
    name, github_url, root_directory, build_command, app_type,
    domain, port, github_repo_id, github_repo_full_name, 
    github_branch, github_installation_id, auto_deploy
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
) RETURNING *;

-- name: UpdateProject :one
UPDATE projects SET
    name = COALESCE(sqlc.narg('name'), name),
    github_url = COALESCE(sqlc.narg('github_url'), github_url),
    root_directory = COALESCE(sqlc.narg('root_directory'), root_directory),
    build_command = COALESCE(sqlc.narg('build_command'), build_command),
    domain = COALESCE(sqlc.narg('domain'), domain),
    auto_deploy = COALESCE(sqlc.narg('auto_deploy'), auto_deploy),
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteProject :exec
DELETE FROM projects WHERE id = $1;

-- name: GetNextAvailablePort :one
SELECT COALESCE(MAX(port), 3000) + 1 AS next_port FROM projects WHERE port IS NOT NULL;
