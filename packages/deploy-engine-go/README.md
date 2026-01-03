# Deploy Engine (Go)

Go rewrite of the deploy engine for improved performance and single-binary deployment.

## Quick Start

```bash
# Download dependencies
make deps

# Run in development
make run

# Build production binary
make build-prod
```

## API Endpoints

| Endpoint                      | Method | Description             |
| ----------------------------- | ------ | ----------------------- |
| `/health`                     | GET    | Health check            |
| `/ready`                      | GET    | Readiness check         |
| `/ports/check`                | POST   | Check port availability |
| `/artifacts/upload?buildId=X` | POST   | Receive build artifact  |
| `/activate`                   | POST   | Activate deployment     |
| `/stop`                       | POST   | Stop deployment         |
| `/projects/{id}/delete`       | POST   | Delete project          |

## Environment Variables

| Variable          | Default               | Description                |
| ----------------- | --------------------- | -------------------------- |
| `PORT`            | 4002                  | Server port                |
| `CONTROL_API_URL` | http://localhost:4000 | Control API URL            |
| `BASE_DOMAIN`     | thakur.dev            | Base domain for subdomains |
| `ARTIFACTS_DIR`   | /tmp/deploy-artifacts | Artifact storage           |
| `APPS_DIR`        | ./apps                | Deployed apps directory    |
| `NODE_ENV`        | development           | Environment mode           |

## Project Structure

```
cmd/engine/          # Entry point
internal/
  config/           # Configuration & framework detection
  server/           # HTTP server & routes
  services/         # Business logic
  utils/            # Utilities
```
