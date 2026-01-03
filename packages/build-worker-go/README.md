# Build Worker (Go)

High-performance Go rewrite of the build worker with worker pools and zero-copy streaming.

## Quick Start

```bash
make deps
make build
./bin/build-worker
```

## Features

- **Worker Pool** - Concurrent builds (`BUILD_WORKERS=3`)
- **Zero-Copy Streaming** - Tar directly to HTTP
- **Channel-Based Logging** - Non-blocking log writes
- **Context Timeouts** - 5 min per command

## API

| Endpoint  | Method | Description       |
| --------- | ------ | ----------------- |
| `/health` | GET    | Health check      |
| `/build`  | POST   | Start async build |

## Environment Variables

| Variable                      | Default               | Description            |
| ----------------------------- | --------------------- | ---------------------- |
| `PORT`                        | 4001                  | Server port            |
| `CONTROL_API_URL`             | http://localhost:4000 | Control API            |
| `DEPLOY_ENGINE_URL`           | http://localhost:4002 | Deploy engine          |
| `BUILD_WORKERS`               | 3                     | Concurrent build limit |
| `WORKSPACE_DIR`               | ./workspace           | Build workspace        |
| `BUN_PATH`                    | bun                   | Path to bun binary     |
| `GITHUB_APP_ID`               | -                     | GitHub App ID          |
| `GITHUB_APP_PRIVATE_KEY_PATH` | -                     | Path to PEM file       |
