# ShipYard

Push-to-deploy for your own server. Connect a GitHub repo, push, and ShipYard builds the app and
serves it on its own domain with HTTPS.

**Website:** https://shipyard.thakur.dev

## Features

- Deploys on every push to the branch you pick, and reports the result on the commit in GitHub
- Builds Next.js, Vite, Bun, Elysia, Hono, Express and Go apps
- Live build logs, and one-click rollback to an earlier build
- A subdomain for every app, plus custom domains with Let's Encrypt certificates
- Encrypted environment variables, pre-deploy commands (for migrations) and monorepo support
- Password protection for any site, and uptime checks with email alerts

Vite builds and Next.js static exports are served by Nginx as files, with no app process.
A Vite build must produce `dist/index.html`. Everything else runs as a process on its own port.

## Install

You need a Debian or Ubuntu server and a user with sudo. Run:

```bash
curl -fsSL https://shipyard.thakur.dev/install.sh | bash
```

The installer asks for one thing: the dashboard's domain, such as `deploy.example.com`. Apps
are then served under `*.example.com`. It installs Nginx, certbot, PostgreSQL, Redis, Bun and
pm0, puts ShipYard in `/opt/shipyard` and starts it. Everything comes back after a reboot.

When it finishes, it prints a setup link. Open it to create the GitHub App (one click), then
sign in with GitHub. The first account becomes the owner, and new sign-ups stay closed until
you open them in Settings.

**DNS:** point `*.example.com` at the server, or add a Cloudflare token in Settings and ShipYard
creates a record for each app. No domain yet? Leave it empty and try ShipYard over HTTP on the
server's IP.

### Update

```bash
/opt/shipyard/scripts/install.sh update   # pull, rebuild what changed, migrate, restart
/opt/shipyard/scripts/install.sh doctor   # read-only health check
```

Running the installer again is safe: it keeps your settings and never changes `SECRET`.

## Configuration

The installer writes `/opt/shipyard/.env` with four values:

```bash
PUBLIC_URL=https://deploy.example.com   # the dashboard; apps go under *.example.com
SECRET=...                              # signs sessions and encrypts env vars. Never change it
DATABASE_URL=postgres://...
REDIS_URL=redis://127.0.0.1:6379/0
```

Everything else is set in the dashboard under **Settings**:

- GitHub App
- Cloudflare DNS (optional)
- Resend, for uptime emails
- Deployments: Docker mode, builds at a time, the port range for apps, and the Let's Encrypt
  email

Values saved in Settings override `.env` and take effect without a restart. Less common
options are listed in [`.env.example`](.env.example).

## Security

Deployed code runs on the same server as ShipYard. On a shared or public server, run apps
under their own account so a bad app or dependency can't reach the platform:

```bash
sudo /opt/shipyard/scripts/isolate-apps.sh
```

See [docs/security.md](docs/security.md) for what that changes, how password-protected sites
work, and how to accept traffic only through Cloudflare.

## Development

```bash
cp .env.example .env      # set SECRET and DATABASE_URL
bun install
bun run migrate
bun run dev               # dashboard at http://localhost:4013
bun test
```

The repository has three packages:

| Package                  | What it does                                                             |
| ------------------------ | ------------------------------------------------------------------------ |
| `packages/ui`            | The dashboard (Next.js, exported as static files that Nginx serves)      |
| `packages/control-api`   | API, database (PostgreSQL + Drizzle), build queue (Redis + BullMQ), logs |
| `packages/deploy-engine` | Clones and builds apps, runs them under pm0 or Docker, configures Nginx  |

The marketing site lives in [`landing/`](landing) and is deployed with ShipYard itself.

## License

[MIT](LICENSE)
