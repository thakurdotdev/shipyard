# Thakur Deploy

Thakur Deploy is a self-hosted PaaS (Platform as a Service) solution built for modern web applications. It allows you to build, deploy, and manage your projects with ease, leveraging a microservices architecture.

## Architecture

The project is structured as a monorepo with the following services:

- **UI (`packages/ui`)**: A Next.js-based dashboard for managing projects, viewing build logs, and controlling deployments.
- **Control API (`packages/control-api`)**: The central management API that orchestrates builds, deployments, and system state.
- **Build Worker (`packages/build-worker`)**: A worker service dedicated to processing build jobs for various application types.
- **Deploy Engine (`packages/deploy-engine`)**: Handles the actual process management and reverse proxy configuration (Nginx) for live deployments.

## Key Features

- **Queue-based Build Worker**: A robust queue system ensures builds are processed efficiently and reliably, preventing system overload.
- **Realtime Logs**: Watch your build process and deployment logs stream in real-time via WebSockets, giving you instant visibility into what's happening.
- **Dynamic Domain Generation**: Automatically assigns and configures subdomains for each deployed project using Nginx wildcard routing.
- **Webhook Triggered Deployments**: Deploy your projects automatically when changes are pushed to your repository.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Frontend**: [Next.js](https://nextjs.org) with Tailwind CSS
- **Database**: PostgreSQL with Drizzle ORM
- **Process Management**: Custom implementation using Child Processes
- **Proxy**: Nginx

## Getting Started

To start the development environment with all services:

```bash
bun run dev
```

This will concurrently start the Control API, Build Worker, Deploy Engine, and UI.

## License

MIT
