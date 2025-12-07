module.exports = {
  apps: [
    {
      name: 'control-api',
      script: 'dist/index.js',
      cwd: 'packages/control-api',
      interpreter: 'bun',
      env: { NODE_ENV: 'production', PORT: 4000 },
    },
    {
      name: 'build-worker',
      script: 'dist/index.js',
      cwd: 'packages/build-worker',
      interpreter: 'bun',
      env: { NODE_ENV: 'production', PORT: 4001 },
    },
    {
      name: 'deploy-engine',
      script: 'dist/index.js',
      cwd: 'packages/deploy-engine',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production',
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
      script: 'dist/index.js',
      cwd: 'packages/webhook-listener',
      interpreter: 'bun',
      env: { NODE_ENV: 'production', PORT: 5050 },
    },
  ],
};
