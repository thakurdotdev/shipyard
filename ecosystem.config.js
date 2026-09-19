const path = require('path');
const BASE_DIR = process.env.BASE_DIR || path.join(__dirname, 'packages/deploy-engine/apps');

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
        BUILD_WORKER_URL: 'http://localhost:4011',
        DEPLOY_ENGINE_URL: 'http://localhost:4012',
      },
    },
    {
      name: 'build-worker',
      script: 'dist/index.js',
      cwd: 'packages/build-worker',
      interpreter: 'bun',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 4011,
        CONTROL_API_URL: 'http://localhost:4010',
        DEPLOY_ENGINE_URL: 'http://localhost:4012',
        BASE_DIR,
      },
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
        CONTROL_API_URL: 'http://localhost:4010',
        BASE_DIR,
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
