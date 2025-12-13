module.exports = {
  apps: [
    {
      name: 'control-api',
      script: 'src/index.ts',
      cwd: 'packages/control-api',
      interpreter: 'bun',
      env: { NODE_ENV: 'production', PORT: 4000 },
    },
    {
      name: 'build-worker',
      script: 'src/index.ts',
      cwd: 'packages/build-worker',
      interpreter: 'bun',
      env: { NODE_ENV: 'production', PORT: 4001 },
    },
    {
      name: 'deploy-engine',
      script: 'src/index.ts',
      cwd: 'packages/deploy-engine',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production',
        PLATFORM_ENV: 'production',
        PORT: 4002,
        NGINX_SITES_DIR: '/etc/nginx/platform-sites',
      },
    },
    {
      name: 'ui',
      script: 'bun',
      args: 'run start',
      cwd: 'packages/ui',
      env: { NODE_ENV: 'production', PORT: 3000 },
    },
    {
      name: 'webhook-listener',
      script: 'src/index.ts',
      cwd: 'packages/webhook-listener',
      interpreter: 'bun',
      env: { NODE_ENV: 'production', PORT: 5050 },
    },
  ],
};
