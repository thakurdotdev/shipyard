module.exports = {
  apps: [
    {
      name: 'control-api',
      script: 'src/index.ts',
      cwd: 'packages/control-api',
      interpreter: 'bun',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', PORT: 4000 },
    },
    {
      name: 'build-worker',
      script: 'src/index.ts',
      cwd: 'packages/build-worker',
      interpreter: 'bun',
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production', PORT: 4001 },
    },
    // {
    //   name: 'deploy-engine',
    //   script: 'src/index.ts',
    //   cwd: 'packages/deploy-engine',
    //   interpreter: 'bun',
    //   max_memory_restart: '256M',
    //   env: {
    //     NODE_ENV: 'production',
    //     PLATFORM_ENV: 'production',
    //     PORT: 4002,
    //     NGINX_SITES_DIR: '/etc/nginx/platform-sites',
    //   },
    // },
    {
      name: 'ui',
      script: 'bun',
      args: 'run start',
      cwd: 'packages/ui',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', PORT: 3000 },
    },
  ],
};
