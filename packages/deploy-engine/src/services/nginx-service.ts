import { existsSync } from 'fs';
import { dirname, join } from 'path';

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'thakur.dev';
const CERTBOT_WEBROOT = process.env.CERTBOT_WEBROOT || '/var/www/certbot';

function getNginxDirs(): { available: string; enabled: string } {
  // If explicitly configured and not default platform-sites
  if (process.env.NGINX_SITES_DIR && process.env.NGINX_SITES_DIR !== '/etc/nginx/platform-sites') {
    return { available: process.env.NGINX_SITES_DIR, enabled: process.env.NGINX_SITES_DIR };
  }

  // Standard Ubuntu / Debian Nginx sites-available and sites-enabled
  if (existsSync('/etc/nginx/sites-available') && existsSync('/etc/nginx/sites-enabled')) {
    return { available: '/etc/nginx/sites-available', enabled: '/etc/nginx/sites-enabled' };
  }

  // If platform-sites directory already exists on host
  if (existsSync('/etc/nginx/platform-sites')) {
    return { available: '/etc/nginx/platform-sites', enabled: '/etc/nginx/platform-sites' };
  }

  // Default to standard Ubuntu sites-available / sites-enabled
  return { available: '/etc/nginx/sites-available', enabled: '/etc/nginx/sites-enabled' };
}

async function writeNginxFile(targetPath: string, content: string): Promise<void> {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    const mkdir = Bun.spawn(['sudo', 'mkdir', '-p', dir]);
    await mkdir.exited;
    const chown = Bun.spawn(['sudo', 'chmod', '755', dir]);
    await chown.exited;
  }

  // Ensure CERTBOT_WEBROOT exists and is readable by Nginx
  if (!existsSync(CERTBOT_WEBROOT)) {
    const mkWebroot = Bun.spawn(['sudo', 'mkdir', '-p', CERTBOT_WEBROOT]);
    await mkWebroot.exited;
  }
  const chWebroot = Bun.spawn(['sudo', 'chmod', '-R', '755', CERTBOT_WEBROOT]);
  await chWebroot.exited;

  try {
    await Bun.write(targetPath, content);
  } catch {
    // If direct write fails (e.g. permission denied), write to /tmp and move with sudo
    const tmpPath = `/tmp/nginx-${Date.now()}-${Math.random().toString(36).slice(2)}.conf`;
    await Bun.write(tmpPath, content);
    const mv = Bun.spawn(['sudo', 'mv', tmpPath, targetPath]);
    await mv.exited;
    const chmod = Bun.spawn(['sudo', 'chmod', '644', targetPath]);
    await chmod.exited;
  }
}

async function linkNginxFile(available: string, enabled: string): Promise<void> {
  if (available === enabled) return;
  const enabledDir = dirname(enabled);
  if (!existsSync(enabledDir)) {
    const mkdir = Bun.spawn(['sudo', 'mkdir', '-p', enabledDir]);
    await mkdir.exited;
  }
  const proc = Bun.spawn(['sudo', 'ln', '-sf', available, enabled]);
  await proc.exited;
}

async function removeNginxFile(filePath: string): Promise<void> {
  if (existsSync(filePath)) {
    const proc = Bun.spawn(['sudo', 'rm', '-f', filePath]);
    await proc.exited;
  }
}

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

  /**
   * Generate nginx config with per-domain SSL certificate paths.
   * Uses the domain's own Let's Encrypt cert instead of a wildcard cert.
   */
  generateConfig(sub: string, port: number) {
    const fullDomain = `${sub}.${BASE_DOMAIN}`;
    return `
server {
    listen 80;
    server_name ${fullDomain};

    # ACME challenge for Let's Encrypt certificate renewal
    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name ${fullDomain};

    # Per-domain SSL certificate (issued by Let's Encrypt)
    ssl_certificate     /etc/letsencrypt/live/${fullDomain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${fullDomain}/privkey.pem;

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

  /**
   * Generate a temporary HTTP-only config for a subdomain.
   * Used BEFORE SSL cert is issued — only serves ACME challenge + proxy.
   * This allows certbot webroot validation to work.
   */
  generateHttpOnlyConfig(sub: string, port: number) {
    const fullDomain = `${sub}.${BASE_DOMAIN}`;
    return `
server {
    listen 80;
    server_name ${fullDomain};

    # ACME challenge for Let's Encrypt certificate issuance
    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`;
  },

  async createConfig(sub: string, port: number) {
    if (!this.isSubdomainAllowed(sub)) {
      throw new Error(`Invalid or reserved subdomain: ${sub}`);
    }

    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);

    await writeNginxFile(availablePath, this.generateConfig(sub, port));
    await linkNginxFile(availablePath, enabledPath);
    await this.reload();
  },

  /**
   * Create an HTTP-only nginx config (no SSL) for ACME challenge serving.
   * Used during initial domain provisioning before SSL cert is issued.
   */
  async createHttpOnlyConfig(sub: string, port: number) {
    if (!this.isSubdomainAllowed(sub)) {
      throw new Error(`Invalid or reserved subdomain: ${sub}`);
    }

    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);

    await writeNginxFile(availablePath, this.generateHttpOnlyConfig(sub, port));
    await linkNginxFile(availablePath, enabledPath);
    await this.reload();
  },

  /**
   * Upgrade an existing HTTP-only config to full HTTPS after SSL cert is issued.
   */
  async upgradeToHttps(sub: string, port: number) {
    const { available } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);

    // Overwrite with the full HTTPS config
    await writeNginxFile(availablePath, this.generateConfig(sub, port));
    await this.reload();
  },

  async removeConfig(sub: string) {
    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);

    await removeNginxFile(enabledPath);
    if (availablePath !== enabledPath) {
      await removeNginxFile(availablePath);
    }

    await this.reload();
  },

  async createDefaultConfig() {
    const content = `
server {
    listen 80;
    server_name _ *.${BASE_DOMAIN};

    # ACME challenge for Let's Encrypt
    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    add_header Content-Type text/plain;
    return 404 "Unknown subdomain. No project deployed.\\n";
}

server {
    listen 443 ssl;
    server_name _ *.${BASE_DOMAIN};

    # Fallback wildcard cert (if available), otherwise self-signed
    ssl_certificate     /etc/letsencrypt/live/${BASE_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${BASE_DOMAIN}/privkey.pem;

    add_header Content-Type text/plain;
    return 404 "Unknown subdomain. No project deployed.\\n";
}
`;

    const { available } = getNginxDirs();
    const file = join(available, '00-default.conf');

    await writeNginxFile(file, content);
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
