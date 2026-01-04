-- name: GetBuildByID :one
SELECT * FROM builds WHERE id = $1;

-- name: ListBuildsByProject :many
SELECT * FROM builds 
WHERE project_id = $1 
ORDER BY created_at DESC 
LIMIT $2;

-- name: GetLatestBuildByProject :one
SELECT * FROM builds 
WHERE project_id = $1 
ORDER BY created_at DESC 
LIMIT 1;

-- name: GetBuildByCommitSHA :one
SELECT * FROM builds 
WHERE project_id = $1 AND commit_sha = $2
LIMIT 1;

-- name: CreateBuild :one
INSERT INTO builds (project_id, status, commit_sha, commit_message)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateBuildStatus :one
UPDATE builds SET
    status = $2,
    completed_at = CASE WHEN $2 IN ('success', 'failed') THEN NOW() ELSE completed_at END
WHERE id = $1
RETURNING *;

-- name: UpdateBuildArtifact :exec
UPDATE builds SET artifact_id = $2 WHERE id = $1;

-- name: DeleteBuildsByProject :exec
DELETE FROM builds WHERE project_id = $1;
