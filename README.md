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
- **Uptime Monitoring**: Schedule public HTTP checks for each project and send account email alerts when an app goes down or recovers.

Uptime email alerts use the Resend API. Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in the Control API environment. Monitoring can be set to check every 1, 5, 10, 15, or 30 minutes. Custom endpoints must resolve to public IP addresses; leaving the endpoint blank uses the project's generated domain once an active deployment exists.

### Password-protected sites

Any project can be put behind a password from **Project → Settings → Password protection**
(turn it on, set a password, choose how long a browser stays signed in). Visitors see a
ShipYard-styled password page on the project's own domain, at the URL they asked for, before
anything from the site is served. Use it for private or personal projects.

How it works: the project's Nginx server block gets an `auth_request` that asks the Control
API (`GET /gate/verify`) about every request, using a signed, HttpOnly session cookie.
`/__shipyard_gate/*` on the site is proxied to the Control API's login routes. Toggling the
setting regenerates and reloads that one Nginx config (`POST /nginx/gate` on the Deploy Engine),
so no redeploy is needed, and later deploys keep the setting.

- The password is stored as an Argon2id hash in `project_access` (never in `projects`, so the
  project APIs cannot return it). Session cookies are signed with a key derived from
  `BETTER_AUTH_SECRET` and the password hash, so changing the password signs everyone out.
- Failed logins are throttled per project and client address (5 per 10 minutes).
- It covers the whole site, including any API routes or webhooks the app exposes.
- If the Control API is unreachable, protected sites fail closed (HTTP 500), never open.
- Uptime checks of the project's own domain carry a signed bypass header so they keep working.
- The dashboard's embedded preview is replaced by an "Open live site" link while protected.
- Enforced by Nginx, so only in production. In development the apps are served directly.
- Deploy Engine reads `CONTROL_API_URL` (a plain `http(s)://host:port`) to reach the gate.
- Apps with their own port must not be reachable from outside the server except through Nginx.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Frontend**: [Next.js](https://nextjs.org) with Tailwind CSS
- **Database**: PostgreSQL with Drizzle ORM
- **Queue**: Redis with BullMQ
- **Process Management**: pm0 (PM2-compatible) for non-Docker deployments; optional Docker mode via `USE_DOCKER=true`
- **Proxy**: Nginx

### Vite deployments

Vite apps are built with the configured build command (normally `bun run build`).
The app directory, including a configured monorepo root directory, must contain
`dist/index.html` after the build. A missing output fails the build and activation.

In production, the domain's Nginx virtual host serves these files directly on the
standard HTTP/HTTPS ports. Vite projects have no assigned application port and no
Bun/pm0 process or Docker container. The dashboard preview serves the same static
root. Port controls are disabled when Vite is selected in project configuration.
This also applies when runtime applications use Docker mode. Local development
uses an automatically assigned port and a small Bun static server, which is also
included in the deploy engine's compiled output.

Browser-history routes fall back to `index.html`, missing bundles return 404, and
HTML is revalidated so browsers pick up new deployments. Static activation probes
the local Nginx HTTPS virtual host using the domain's SNI, validates its certificate,
and checks that the response matches the new build (bypassing DNS/CDN caches).
Configuration or readiness failures restore the previous domain configuration.
Existing Vite deployments migrate on their next activation: the old per-project
Nginx listener and managed application process are retired, then the stored port
is cleared. No database migration is required.
The Nginx worker must have read/traverse access to the deployed `dist` directory
and its parent directories (the default `/var/lib/shipyard/apps` location is intended
for this). An unreadable output fails the activation health check.

## Getting Started

To start the development environment with all services:

```bash
bun run dev
```

This will concurrently start the Control API, Deploy Engine (which also runs the build worker), and UI.
