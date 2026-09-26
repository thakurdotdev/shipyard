# ShipYard

ShipYard is a self-hosted PaaS (Platform as a Service) solution built for modern web applications. It allows you to build, deploy, and manage your projects with ease, leveraging a microservices architecture.

## Architecture

The project is structured as a monorepo with the following services:

- **UI (`packages/ui`)**: A Next.js-based dashboard for managing projects, viewing build logs, and controlling deployments.
- **Control API (`packages/control-api`)**: The central management API that orchestrates builds, deployments, and system state. It owns the database and the realtime WebSocket log stream.
- **Deploy Engine (`packages/deploy-engine`)**: The single worker service. It consumes build jobs from the queue, clones and builds each project **in place**, then activates it via the process manager (pm0) and configures the reverse proxy (Nginx). Since builds land directly in the deployment directory, dependencies are installed once and reused at activation.

## Key Features

- **Queue-based builds**: A Redis/BullMQ queue ensures builds are processed one at a time, preventing system overload while still surfacing queue position to the UI.
- **Build-in-place deploys**: The deploy engine builds each project directly into its deployment directory, so there is no artifact copy step and no second `bun install` during activation.
- **Realtime Logs**: Watch build and deployment logs stream in real-time via WebSockets, giving you instant visibility into what's happening.
- **Dynamic Domain Generation**: Automatically assigns and configures subdomains for each deployed project using Nginx wildcard routing.
- **Webhook Triggered Deployments**: Deploy your projects automatically when changes are pushed to your repository.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Frontend**: [Next.js](https://nextjs.org) with Tailwind CSS
- **Database**: PostgreSQL with Drizzle ORM
- **Queue**: Redis with BullMQ
- **Process Management**: pm0 (PM2-compatible) for non-Docker deployments; optional Docker mode via `USE_DOCKER=true`
- **Proxy**: Nginx

## Getting Started

To start the development environment with all services:

```bash
bun run dev
```

This will concurrently start the Control API, Deploy Engine (which also runs the build worker), and UI.
