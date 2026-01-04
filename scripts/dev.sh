#!/bin/bash
# Development start script - runs all services
# Usage: ./scripts/dev.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Thakur Deploy Development Environment${NC}"
echo ""

# Check for required tools
command -v go >/dev/null 2>&1 || { echo -e "${RED}Go is required but not installed.${NC}"; exit 1; }
command -v bun >/dev/null 2>&1 || { echo -e "${RED}Bun is required but not installed.${NC}"; exit 1; }

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load env file if exists
if [ -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${BLUE}📄 Loading .env file${NC}"
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down all services...${NC}"
    kill $(jobs -p) 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# # Start Control API (Go) - Port 4000
# echo -e "${GREEN}[1/4] Starting Control API (Go) on port 4000...${NC}"
# cd "$PROJECT_ROOT/packages/control-api-go"
# go run ./cmd/api &

# Start Build Worker (Go) - Port 4001  
echo -e "${GREEN}[2/4] Starting Build Worker (Go) on port 4001...${NC}"
cd "$PROJECT_ROOT/packages/build-worker-go"
go run ./cmd/worker &

# Start Deploy Engine (Go) - Port 4002
echo -e "${GREEN}[3/4] Starting Deploy Engine (Go) on port 4002...${NC}"
cd "$PROJECT_ROOT/packages/deploy-engine-go"
go run ./cmd/engine &

# Wait a bit for Go services to start
sleep 2

# Start Next.js UI - Port 3000
echo -e "${GREEN}[4/4] Starting Next.js UI on port 3000...${NC}"
cd "$PROJECT_ROOT/packages/ui"
bun run dev &

echo ""
echo -e "${GREEN}✅ All services started!${NC}"
echo ""
echo -e "  ${BLUE}Frontend:${NC}       http://localhost:3000"
# echo -e "  ${BLUE}Control API:${NC}    http://localhost:4000"
echo -e "  ${BLUE}Build Worker:${NC}   http://localhost:4001"
echo -e "  ${BLUE}Deploy Engine:${NC}  http://localhost:4002"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

# Wait for all background processes
wait
