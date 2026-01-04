-- name: GetDeploymentByID :one
SELECT * FROM deployments WHERE id = $1;

-- name: GetActiveDeploymentByProject :one
SELECT * FROM deployments 
WHERE project_id = $1 AND status = 'active'
LIMIT 1;

-- name: ListDeploymentsByProject :many
SELECT * FROM deployments 
WHERE project_id = $1 
ORDER BY activated_at DESC;

-- name: CreateDeployment :one
INSERT INTO deployments (project_id, build_id, status)
VALUES ($1, $2, $3)
RETURNING *;

-- name: DeactivateProjectDeployments :exec
UPDATE deployments SET status = 'inactive' WHERE project_id = $1;

-- name: ActivateDeployment :one
UPDATE deployments SET status = 'active', activated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteDeploymentsByProject :exec
DELETE FROM deployments WHERE project_id = $1;
