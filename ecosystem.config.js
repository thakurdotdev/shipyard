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
      name: 'build-worker',
      script: 'dist/index.js',
      cwd: 'packages/build-worker',
      interpreter: 'bun',
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production', PORT: 4011 },
    },
    {
      name: 'deploy-engine',
      script: 'dist/index.js',
      cwd: 'packages/deploy-engine',
      interpreter: 'bun',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PLATFORM_ENV: 'production',
        PORT: 4012,
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
