-- name: GetBuildLogsByBuild :many
SELECT * FROM build_logs 
WHERE build_id = $1 
ORDER BY timestamp ASC;

-- name: CreateBuildLog :one
INSERT INTO build_logs (build_id, level, message)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CreateBuildLogsBatch :copyfrom
INSERT INTO build_logs (build_id, level, message)
VALUES ($1, $2, $3);

-- name: DeleteBuildLogsByBuild :exec
DELETE FROM build_logs WHERE build_id = $1;

-- name: GetBuildLogCount :one
SELECT COUNT(*) FROM build_logs WHERE build_id = $1;
