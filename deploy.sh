#!/bin/bash
set -e

WORKDIR="/mnt/dev/thakur-deploy"
cd "$WORKDIR"

git fetch --all

# Before updating repo
OLD_COMMIT=$(git rev-parse HEAD)

git reset --hard origin/main
git clean -fd

NEW_COMMIT=$(git rev-parse HEAD)

# Detect changed files
CHANGED_FILES=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT")
echo "Changed files:"
echo "$CHANGED_FILES"

changed() {
  echo "$CHANGED_FILES" | grep -q "^$1"
}

# Install dependencies only when bun.lockb or any package.json changed
if echo "$CHANGED_FILES" | grep -qE "bun.lockb|package.json"; then
  echo "Dependencies changed → running bun install"
  bun install
else
  echo "Skipping bun install (no dependency changes)"
fi

# Build UI only if UI changed
if changed "packages/ui"; then
  echo "UI changed → rebuilding UI"
  (cd packages/ui && bun run build)
else
  echo "UI unchanged → skipping build"
fi

# Map package directories to PM2 service names
declare -A SERVICE_MAP
SERVICE_MAP["packages/control-api"]="control-api"
SERVICE_MAP["packages/build-worker"]="build-worker"
SERVICE_MAP["packages/deploy-engine"]="deploy-engine"
SERVICE_MAP["packages/ui"]="ui"

SERVICES_TO_RELOAD=()

# Add services whose directories changed
for dir in "${!SERVICE_MAP[@]}"; do
  if changed "$dir"; then
    SERVICES_TO_RELOAD+=("${SERVICE_MAP[$dir]}")
  fi
done

# Root-level changes affecting all services?
if changed "ecosystem.config.js"; then
  echo "ecosystem.config.js changed → full reload"
  SERVICES_TO_RELOAD=("control-api" "build-worker" "deploy-engine" "ui")
fi

# Apply reloads
if [ ${#SERVICES_TO_RELOAD[@]} -eq 0 ]; then
  echo "No services need reload."
else
  echo "Reloading services: ${SERVICES_TO_RELOAD[*]}"
  for svc in "${SERVICES_TO_RELOAD[@]}"; do
    pm2 reload "$svc"
  done
fi

echo "Deploy complete."
