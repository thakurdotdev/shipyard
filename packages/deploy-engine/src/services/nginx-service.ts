import { config } from '@thakur-deploy/config';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { staticSiteLocations } from './static-site';

const CERTBOT_WEBROOT = process.env.CERTBOT_WEBROOT || '/var/www/certbot';

// Read on use: the engine learns these from the Control API shortly after it starts.
const baseDomain = () => config.baseDomain;
const dashboardOrigin = () => config.publicUrl;

/** Public path on a protected site that nginx proxies to the Control API's login page. */
export const GATE_PATH = '/__shipyard_gate';
const GATE_MARKER = '# shipyard-gate: on';

function gateUpstream(): string {
  const upstream = config.controlApiUrl;
  // Interpolated into nginx config, so anything but a plain origin is rejected.
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(upstream)) {
    throw new Error(
      'CONTROL_API_URL must be a plain http(s)://host[:port] origin to protect sites',
    );
  }
  return upstream;
}

/**
 * Password gate for a site. Every request first goes to the Control API, which accepts or
 * rejects it from the visitor's cookie; rejected visitors get the login page at their own URL.
 * The gate's own routes and the ACME challenge are exempt.
 */
function gateDirectives(): string {
  const upstream = gateUpstream();
  return `
    # Password gate (managed by ShipYard)
    auth_request /__shipyard_auth;
    error_page 401 ${GATE_PATH}/login;

    location = /__shipyard_auth {
        internal;
        proxy_pass ${upstream}/gate/verify;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Host $host;
        proxy_set_header X-Gate-Host $host;
        proxy_connect_timeout 3s;
        proxy_read_timeout 5s;
    }

    location ^~ ${GATE_PATH}/ {
        auth_request off;
        client_max_body_size 4k;
        proxy_pass ${upstream}/gate/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Gate-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Original-URI $request_uri;
        proxy_connect_timeout 5s;
        proxy_read_timeout 15s;
    }
`;
}

function acmeLocation(gated: boolean): string {
  return `location /.well-known/acme-challenge/ { ${gated ? 'auth_request off; ' : ''}root ${CERTBOT_WEBROOT}; }`;
}

function configHeader(root: string | null, gated: boolean): string {
  return [
    root ? `# shipyard-static-root: ${JSON.stringify(root)}` : null,
    gated ? GATE_MARKER : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function validateStaticRoot(root: string) {
  if (!root.startsWith('/') || /[\r\n\0"\\$]/.test(root)) {
    throw new Error('Invalid static site directory');
  }
}

function staticDomainLocations(root: string | null): string {
  if (!root) return 'location / { return 503; }';
  validateStaticRoot(root);
  return `
    root "${root}";
${staticSiteLocations()}
    location = /__shipyard_preview {
        return 301 /__shipyard_preview/;
    }

    location = /__shipyard_preview/ {
        rewrite ^ /__shipyard_preview_shell last;
    }

    location ^~ /__shipyard_preview/ {
        rewrite ^/__shipyard_preview/(.*)$ /$1 break;
        try_files $uri @shipyard_preview_fallback;
        add_header Cache-Control "no-cache" always;
        add_header Content-Security-Policy "frame-ancestors ${dashboardOrigin()}" always;
    }

    location @shipyard_preview_fallback {
        if ($uri ~* "\\.(js|mjs|css|map|json|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|wasm|txt|xml|webmanifest)$") { return 404; }
        if ($uri ~ "^/assets/") { return 404; }
        rewrite ^ /__shipyard_preview_shell last;
    }

    location = /__shipyard_preview_shell {
        internal;
        try_files /index.html =404;
        default_type text/html;
        add_header Cache-Control "no-cache" always;
        add_header Content-Security-Policy "frame-ancestors ${dashboardOrigin()}" always;
    }
`;
}

async function runChecked(command: string[]) {
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed: ${stderr.trim() || stdout.trim()}`);
  }
}

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

async function writeNginxFile(
  targetPath: string,
  content: string,
  needsCertbot = true,
): Promise<void> {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    await runChecked(['sudo', 'mkdir', '-p', dir]);
    await runChecked(['sudo', 'chmod', '755', dir]);
  }

  // Ensure CERTBOT_WEBROOT exists and is readable by Nginx
  if (needsCertbot && !existsSync(CERTBOT_WEBROOT)) {
    await runChecked(['sudo', 'mkdir', '-p', CERTBOT_WEBROOT]);
    await runChecked(['sudo', 'chmod', '755', CERTBOT_WEBROOT]);
  }

  try {
    await Bun.write(targetPath, content);
  } catch {
    // If direct write fails (e.g. permission denied), write to /tmp and move with sudo
    const tmpPath = `/tmp/nginx-${Date.now()}-${Math.random().toString(36).slice(2)}.conf`;
    await Bun.write(tmpPath, content);
    await runChecked(['sudo', 'mv', tmpPath, targetPath]);
    await runChecked(['sudo', 'chmod', '644', targetPath]);
  }
}

async function linkNginxFile(available: string, enabled: string): Promise<void> {
  if (available === enabled) return;
  const enabledDir = dirname(enabled);
  if (!existsSync(enabledDir)) {
    await runChecked(['sudo', 'mkdir', '-p', enabledDir]);
  }
  await runChecked(['sudo', 'ln', '-sf', available, enabled]);
}

async function removeNginxFile(filePath: string): Promise<void> {
  if (existsSync(filePath)) {
    await runChecked(['sudo', 'rm', '-f', filePath]);
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
  domainForSubdomain(sub: string) {
    if (!this.isSubdomainAllowed(sub)) throw new Error(`Invalid or reserved subdomain: ${sub}`);
    return `${sub}.${baseDomain()}`;
  },

  getStaticRoot(sub: string): string | null {
    this.domainForSubdomain(sub);
    const path = join(getNginxDirs().available, `${sub}.conf`);
    if (!existsSync(path)) return null;
    const marker = readFileSync(path, 'utf8').match(/^# shipyard-static-root: (.+)$/m);
    if (!marker) return null;
    const root: unknown = JSON.parse(marker[1]);
    if (typeof root !== 'string') throw new Error('Invalid static site root marker');
    validateStaticRoot(root);
    return root;
  },

  /** Whether the live config for this subdomain currently has the password gate on. */
  getGate(sub: string): boolean {
    this.domainForSubdomain(sub);
    const path = join(getNginxDirs().available, `${sub}.conf`);
    return existsSync(path) && /^# shipyard-gate: on$/m.test(readFileSync(path, 'utf8'));
  },

  generateStaticDomainConfig(sub: string, root: string | null, gate?: boolean): string {
    const domain = this.domainForSubdomain(sub);
    const gated = gate ?? this.getGate(sub);
    return `${configHeader(root, gated)}
server {
    listen 80;
    server_name ${domain};
    location /.well-known/acme-challenge/ { root ${CERTBOT_WEBROOT}; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name ${domain};
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ${acmeLocation(gated)}
${gated ? gateDirectives() : ''}${staticDomainLocations(root)}
}
`;
  },

  async createStaticDomainConfig(
    sub: string,
    root: string,
    verify: () => Promise<void>,
    gated?: boolean,
  ) {
    await this.applyDomainConfig(sub, this.generateStaticDomainConfig(sub, root, gated), verify);
  },

  staticConfigPath(projectId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Invalid project ID');
    // Keep runtime listeners separate from the public domain/SSL configuration.
    return join(getNginxDirs().available, `shipyard-static-${projectId}.conf`);
  },

  async removeStaticConfig(projectId: string) {
    const path = this.staticConfigPath(projectId);
    if (!existsSync(path)) return;
    const enabled = join(getNginxDirs().enabled, `shipyard-static-${projectId}.conf`);
    await removeNginxFile(enabled);
    if (path !== enabled) await removeNginxFile(path);
    await this.reload();
  },

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
  generateConfig(sub: string, port: number | null, gate?: boolean) {
    const gated = gate ?? this.getGate(sub);
    if (port === null) return this.generateStaticDomainConfig(sub, this.getStaticRoot(sub), gated);
    const fullDomain = `${sub}.${baseDomain()}`;
    return `${configHeader(null, gated)}
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
${gated ? gateDirectives() : ''}
    # The isolated preview route can be embedded only by the ShipYard dashboard.
    # Keep these header changes scoped here; the public application route below
    # preserves the app's own framing policy.
    location = /__shipyard_preview {
        return 301 /__shipyard_preview/;
    }

    location ^~ /__shipyard_preview/ {
        proxy_pass http://localhost:${port}/;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_hide_header X-Frame-Options;
        proxy_hide_header Content-Security-Policy;
        add_header Content-Security-Policy "frame-ancestors ${dashboardOrigin()}" always;

        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }

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
  generateHttpOnlyConfig(sub: string, port: number | null, gate?: boolean) {
    const gated = gate ?? this.getGate(sub);
    const fullDomain = `${sub}.${baseDomain()}`;
    // The login page needs HTTPS (its cookie is Secure), so until the certificate exists a
    // protected site serves nothing but the ACME challenge rather than its content.
    if (gated) {
      return `${configHeader(port === null ? this.getStaticRoot(sub) : null, true)}
server {
    listen 80;
    server_name ${fullDomain};
    location /.well-known/acme-challenge/ { root ${CERTBOT_WEBROOT}; }
    location / { return 503; }
}
`;
    }
    if (port === null) {
      const root = this.getStaticRoot(sub);
      return `${configHeader(root, false)}
server {
    listen 80;
    server_name ${fullDomain};
    ${acmeLocation(false)}
${staticDomainLocations(root)}
}
`;
    }
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

  async createConfig(sub: string, port: number | null, gated?: boolean) {
    await this.applyDomainConfig(sub, this.generateConfig(sub, port, gated));
  },

  /**
   * Turn the password gate on or off for a live site without redeploying it.
   * Returns false when the site has no config yet; the next activation applies the setting.
   */
  async setGate(sub: string, port: number | null, gated: boolean): Promise<boolean> {
    this.domainForSubdomain(sub);
    const path = join(getNginxDirs().available, `${sub}.conf`);
    if (!existsSync(path)) return false;

    const hasHttps = /^\s*listen 443\b/m.test(readFileSync(path, 'utf8'));
    const root = this.getStaticRoot(sub);
    if (!root && port === null) throw new Error('No active static site configuration found');
    const config = hasHttps
      ? this.generateConfig(sub, root ? null : port, gated)
      : this.generateHttpOnlyConfig(sub, root ? null : port, gated);
    await this.applyDomainConfig(sub, config);
    return true;
  },

  async applyDomainConfig(sub: string, content: string, verify?: () => Promise<void>) {
    if (!this.isSubdomainAllowed(sub)) {
      throw new Error(`Invalid or reserved subdomain: ${sub}`);
    }

    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);

    const previous = existsSync(availablePath) ? readFileSync(availablePath, 'utf8') : null;
    try {
      await writeNginxFile(availablePath, content, false);
      await linkNginxFile(availablePath, enabledPath);
      await this.reload();
      await verify?.();
    } catch (error) {
      // A failed reload must not leave an invalid file blocking every later deploy.
      if (previous !== null) {
        await writeNginxFile(availablePath, previous, false);
      } else {
        await removeNginxFile(enabledPath);
        if (availablePath !== enabledPath) await removeNginxFile(availablePath);
      }
      await this.reload();
      throw error;
    }
  },

  async ensurePreviewConfig(sub: string, port: number | null) {
    if (!this.isSubdomainAllowed(sub)) {
      throw new Error(`Invalid or reserved subdomain: ${sub}`);
    }

    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);
    if (existsSync(availablePath) && existsSync(enabledPath)) {
      try {
        const config = readFileSync(availablePath, 'utf8');
        if (
          config.includes('location ^~ /__shipyard_preview/') &&
          (this.getStaticRoot(sub) !== null ||
            config.includes(`proxy_pass http://localhost:${port}/;`))
        ) {
          return;
        }
      } catch {
        // Rebuild the config below if it cannot be read.
      }
    }

    const root = this.getStaticRoot(sub);
    if (root) {
      await this.applyDomainConfig(sub, this.generateStaticDomainConfig(sub, root));
    } else {
      if (port === null) throw new Error('No active static site configuration found');
      await this.createConfig(sub, port);
    }
  },

  /**
   * Create an HTTP-only nginx config (no SSL) for ACME challenge serving.
   * Used during initial domain provisioning before SSL cert is issued.
   */
  async createHttpOnlyConfig(sub: string, port: number | null, gated?: boolean) {
    if (!this.isSubdomainAllowed(sub)) {
      throw new Error(`Invalid or reserved subdomain: ${sub}`);
    }

    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);

    await writeNginxFile(availablePath, this.generateHttpOnlyConfig(sub, port, gated));
    await linkNginxFile(availablePath, enabledPath);
    await this.reload();
  },

  /**
   * Upgrade an existing HTTP-only config to full HTTPS after SSL cert is issued.
   */
  async upgradeToHttps(sub: string, port: number | null, gated?: boolean) {
    await this.createConfig(sub, port, gated);
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
    server_name _ *.${baseDomain()};

    # ACME challenge for Let's Encrypt
    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    add_header Content-Type text/plain;
    return 404 "Unknown subdomain. No project deployed.\\n";
}

server {
    listen 443 ssl;
    server_name _ *.${baseDomain()};

    # Fallback wildcard cert (if available), otherwise self-signed
    ssl_certificate     /etc/letsencrypt/live/${baseDomain()}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${baseDomain()}/privkey.pem;

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
      await runChecked(['sudo', 'nginx', '-t']);
      await runChecked(['sudo', 'systemctl', 'reload', 'nginx']);
    });
  },
};
