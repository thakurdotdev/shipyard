-- name: GetEnvVarsByProject :many
SELECT * FROM environment_variables 
WHERE project_id = $1 
ORDER BY key;

-- name: GetEnvVar :one
SELECT * FROM environment_variables 
WHERE project_id = $1 AND key = $2;

-- name: UpsertEnvVar :one
INSERT INTO environment_variables (project_id, key, value)
VALUES ($1, $2, $3)
ON CONFLICT (project_id, key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW()
RETURNING *;

-- name: DeleteEnvVar :exec
DELETE FROM environment_variables 
WHERE project_id = $1 AND key = $2;

-- name: DeleteEnvVarsByProject :exec
DELETE FROM environment_variables WHERE project_id = $1;
