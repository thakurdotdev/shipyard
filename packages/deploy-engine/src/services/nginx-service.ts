import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'thakur.dev';
const AVAILABLE_DIR = '/etc/nginx/platform-sites';
const ENABLED_DIR = '/etc/nginx/platform-sites';

const RESERVED = [
  'www',
  'api',
  'admin',
  'dashboard',
  'deploy',
  'git',
  'db',
  'mail',
  'staging',
  'dev',
];

// Bounded retry helper
async function retry(fn: () => Promise<void>, retries = 3, delayMs = 300) {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

export const NginxService = {
  isSubdomainAllowed(sub: string) {
    if (!sub) return false;
    const s = sub.toLowerCase().trim();
    if (RESERVED.includes(s)) return false;
    if (!/^[a-z0-9-]+$/.test(s)) return false;
    if (s.startsWith('-') || s.endsWith('-')) return false;
    return true;
  },

  generateConfig(sub: string, port: number) {
    return `
server {
    listen 80;
    server_name ${sub}.${BASE_DOMAIN};

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${sub}.${BASE_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${BASE_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${BASE_DOMAIN}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
`;
  },

  async createConfig(sub: string, port: number) {
    if (!this.isSubdomainAllowed(sub)) {
      throw new Error(`Invalid or reserved subdomain: ${sub}`);
    }

    const available = join(AVAILABLE_DIR, `${sub}.conf`);
    const enabled = join(ENABLED_DIR, `${sub}.conf`);

    await Bun.write(available, this.generateConfig(sub, port));

    if (!existsSync(enabled)) {
      await Bun.spawn(['ln', '-sf', available, enabled]).exited;
    }

    await this.reload();
  },

  async removeConfig(sub: string) {
    const available = join(AVAILABLE_DIR, `${sub}.conf`);
    const enabled = join(ENABLED_DIR, `${sub}.conf`);

    if (existsSync(enabled)) await unlink(enabled);
    if (existsSync(available)) await unlink(available);

    await this.reload();
  },

  async createDefaultConfig() {
    const content = `
server {
    listen 80;
    server_name _ *.${BASE_DOMAIN};
    add_header Content-Type text/plain;
    return 404 "Unknown subdomain. No project deployed.\\n";
}

server {
    listen 443 ssl;
    server_name _ *.${BASE_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${BASE_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${BASE_DOMAIN}/privkey.pem;

    add_header Content-Type text/plain;
    return 404 "Unknown subdomain. No project deployed.\\n";
}
`;

    const file = join(AVAILABLE_DIR, '00-default.conf');

    await Bun.write(file, content);
    await this.reload();
  },

  async reload() {
    await retry(async () => {
      const test = Bun.spawn(['sudo', 'nginx', '-t']);
      await test.exited;
      if (test.exitCode !== 0) {
        throw new Error('nginx config validation failed');
      }

      const reload = Bun.spawn(['sudo', 'systemctl', 'reload', 'nginx']);
      await reload.exited;
      if (reload.exitCode !== 0) {
        throw new Error('nginx reload failed');
      }
    });
  },
};
