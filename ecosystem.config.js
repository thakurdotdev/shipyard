module.exports = {
  apps: [
    {
      name: 'control-api',
      script: 'dist/index.js',
      cwd: 'packages/control-api',
      interpreter: 'bun',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 4010,
        DEPLOY_ENGINE_URL: 'http://localhost:4012',
      },
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
        PLATFORM_ENV: 'production',
        PORT: 4012,
        CONTROL_API_URL: 'http://localhost:4010',
        REDIS_URL: 'redis://localhost:6379/0',
      },
    },
    {
      name: 'ui',
      script: 'bun',
      args: 'run start',
      cwd: 'packages/ui',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', PORT: 4013 },
    },
  ],
};
