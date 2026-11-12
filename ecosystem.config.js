// pm0 / PM2 process file for the ShipYard platform itself. Settings come from `.env` at the
// repository root (see .env.example); only per-process values live here. The dashboard has
// no process: it is a static export (packages/ui/out) that Nginx serves.
module.exports = {
  apps: [
    {
      name: 'control-api',
      script: 'dist/index.js',
      cwd: 'packages/control-api',
      interpreter: 'bun',
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production', PORT: 4010 },
    },
    {
      // Deploy engine also runs the build worker: it clones, installs and builds
      // in place, then activates the build on the same server.
      name: 'deploy-engine',
      script: 'dist/index.js',
      cwd: 'packages/deploy-engine',
      interpreter: 'bun',
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        PORT: 4012,
        // Keep deployed apps OUTSIDE the platform repo so framework workspace-root
        // detection doesn't pick up this repo's own package.json/lockfile. The installer
        // creates it; by hand: sudo mkdir -p /var/lib/shipyard/apps && sudo chown $USER /var/lib/shipyard/apps
        BASE_DIR: '/var/lib/shipyard/apps',
      },
    },
  ],
};
