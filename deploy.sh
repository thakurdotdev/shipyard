#!/bin/bash
set -e

# -----------------------------------------------------
# HARD-ENFORCE PRODUCTION ENV (build + runtime)
# -----------------------------------------------------
export NODE_ENV=production
export PLATFORM_ENV=production

WORKDIR="/opt/platform/deploy-project"
cd "$WORKDIR"

echo "Deploying commit in PRODUCTION mode"
echo "NODE_ENV=$NODE_ENV"
echo "PLATFORM_ENV=$PLATFORM_ENV"

echo "Fetching latest changes..."
git fetch --all

OLD_COMMIT=$(git rev-parse HEAD)

echo "Resetting to origin/main..."
git reset --hard origin/main
git clean -fd

NEW_COMMIT=$(git rev-parse HEAD)

CHANGED_FILES=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT")
echo "Changed files:"
echo "$CHANGED_FILES"

changed() {
  echo "$CHANGED_FILES" | grep -q "^$1/"
}

# -----------------------------------------------------
# Install dependencies only if package.json or bun.lockb changed
# -----------------------------------------------------
if echo "$CHANGED_FILES" | grep -qE "bun.lockb|package.json"; then
  echo "Dependencies changed → running bun install"
  bun install
else
  echo "Dependencies unchanged → skipping bun install"
fi

# -----------------------------------------------------
# UI build (Next.js / Vite picks up NODE_ENV automatically)
# -----------------------------------------------------
if changed "packages/ui"; then
  echo "UI changed → rebuilding UI (production)"
  (cd packages/ui && NODE_ENV=production bun run build)
else
  echo "UI unchanged → skipping UI build"
fi

# -----------------------------------------------------
# Backend builds (critical: NODE_ENV present at build time)
# -----------------------------------------------------
BACKEND_SERVICES=(
  "packages/control-api"
  "packages/build-worker"
  "packages/deploy-engine"
  "packages/webhook-listener"
)

for dir in "${BACKEND_SERVICES[@]}"; do
  if changed "$dir"; then
    echo "$dir changed → rebuilding (production)"
    (cd "$dir" && NODE_ENV=production bun run build)
  else
    echo "$dir unchanged → skipping build"
  fi
done

# -----------------------------------------------------
# PM2 reload mapping
# -----------------------------------------------------
declare -A SERVICE_MAP
SERVICE_MAP["packages/control-api"]="control-api"
SERVICE_MAP["packages/build-worker"]="build-worker"
SERVICE_MAP["packages/deploy-engine"]="deploy-engine"
SERVICE_MAP["packages/ui"]="ui"
SERVICE_MAP["packages/webhook-listener"]="webhook-listener"

SERVICES_TO_RELOAD=()

for dir in "${!SERVICE_MAP[@]}"; do
  if changed "$dir"; then
    SERVICES_TO_RELOAD+=("${SERVICE_MAP[$dir]}")
  fi
done

# If ecosystem changed → full reload
if echo "$CHANGED_FILES" | grep -q "^ecosystem.config.js"; then
  echo "ecosystem.config.js changed → full reload"
  SERVICES_TO_RELOAD=("control-api" "build-worker" "deploy-engine" "ui" "webhook-listener")
fi

# -----------------------------------------------------
# Apply reloads (env must be refreshed)
# -----------------------------------------------------
if [ ${#SERVICES_TO_RELOAD[@]} -eq 0 ]; then
  echo "No services need reload."
else
  echo "Reloading services: ${SERVICES_TO_RELOAD[*]}"
  for svc in "${SERVICES_TO_RELOAD[@]}"; do
    pm2 reload "$svc" --update-env
  done
fi

echo "Tada! Deploy complete in PRODUCTION. 🚀"
