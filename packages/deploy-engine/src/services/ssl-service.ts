import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { LogService } from './log-service';
import { engineSettings } from '../config/runtime-settings';

const CERTBOT_WEBROOT = process.env.CERTBOT_WEBROOT || '/var/www/certbot';
// The email is optional (Settings → Deployments, or CERTBOT_EMAIL): certbot registers its
// account once (the installer does it with your email), and Let's Encrypt no longer sends
// expiry emails, so later requests don't need one.
const LETSENCRYPT_DIR = '/etc/letsencrypt/live';

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** DNS names in `openssl x509 -ext subjectAltName` output. */
export function parseSanNames(output: string): string[] {
  return [...output.matchAll(/DNS:([^,\s]+)/g)].map((m) => m[1].toLowerCase());
}

interface SSLResult {
  /** True when an existing certificate already covered every name. */
  reused?: boolean;
  success: boolean;
  certPath?: string;
  keyPath?: string;
  expiry?: Date;
  error?: string;
}

export const SSLService = {
  /**
   * Issue a Let's Encrypt SSL certificate for a domain using certbot webroot method.
   * Requires nginx to be running and serving /.well-known/acme-challenge/ from CERTBOT_WEBROOT.
   */
  async issueCertificate(
    domain: string,
    buildId?: string,
    aliases: string[] = [],
  ): Promise<SSLResult> {
    const names = [...new Set([domain, ...aliases].map((n) => n.trim().toLowerCase()))];
    const invalid = names.find((n) => !HOSTNAME.test(n));
    if (invalid) return { success: false, error: `Invalid domain name: ${invalid}` };
    console.log(`[SSLService] Issuing certificate for ${names.join(', ')}`);

    // Reuse an existing certificate when it already covers every name.
    const existing = await this.checkCertificate(domain);
    if (existing.success && existing.certPath) {
      const covered = await this.getCertNames(domain);
      // Unknown coverage (unreadable SANs) keeps the old behaviour: reuse it.
      if (covered === null || names.every((n) => covered.includes(n))) {
        console.log(`[SSLService] Certificate already exists for ${names.join(', ')}`);
        if (buildId) {
          await LogService.success(buildId, `Existing SSL certificate found for ${domain}`);
        }
        return { ...existing, reused: true };
      }
      console.log(`[SSLService] Certificate for ${domain} lacks some names; expanding it`);
    }

    if (buildId) {
      await LogService.step(buildId, `Requesting Let's Encrypt SSL certificate for ${domain}`);
    }

    // Ensure webroot directory exists and is readable by Nginx
    if (!existsSync(CERTBOT_WEBROOT)) {
      const mkdirProc = Bun.spawn(['sudo', 'mkdir', '-p', CERTBOT_WEBROOT]);
      await mkdirProc.exited;
    }
    const chmodProc = Bun.spawn(['sudo', 'chmod', '-R', '755', CERTBOT_WEBROOT]);
    await chmodProc.exited;

    try {
      const certbotEmail = engineSettings().certbotEmail;
      const args = [
        'sudo',
        'certbot',
        'certonly',
        '--webroot',
        '-w',
        CERTBOT_WEBROOT,
        '--cert-name',
        domain,
        ...names.flatMap((name) => ['-d', name]),
        '--expand',
        '--non-interactive',
        '--agree-tos',
        ...(certbotEmail ? ['--email', certbotEmail] : ['--register-unsafely-without-email']),
        '--no-eff-email',
        // Force renewal if cert exists but is invalid
        '--force-renewal',
      ];

      console.log(`[SSLService] Running: ${args.join(' ')}`);
      if (buildId) {
        await LogService.detail(buildId, `Running certbot HTTP-01 webroot challenge...`);
      }

      const proc = Bun.spawn(args, {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Capture output
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      await proc.exited;

      if (proc.exitCode !== 0) {
        console.error(`[SSLService] certbot failed (exit ${proc.exitCode})`);
        console.error(`[SSLService] stdout: ${stdout}`);
        console.error(`[SSLService] stderr: ${stderr}`);
        const errMsg = `certbot failed: ${stderr || stdout}`.slice(0, 500);
        if (buildId) {
          await LogService.error(buildId, `Certbot failed: ${(stderr || stdout).trim()}`);
        }
        return {
          success: false,
          error: errMsg,
        };
      }

      console.log(`[SSLService] Certificate issued successfully for ${domain}`);
      console.log(`[SSLService] stdout: ${stdout}`);

      // Ensure Nginx worker processes (www-data) can read certificates and keys
      const chownProc = Bun.spawn([
        'sudo',
        'chmod',
        '-R',
        'a+rX',
        '/etc/letsencrypt/live',
        '/etc/letsencrypt/archive',
      ]);
      await chownProc.exited;

      if (buildId) {
        await LogService.detail(buildId, `Certificate saved at /etc/letsencrypt/live/${domain}/`);
        await LogService.success(buildId, `SSL certificate successfully installed for ${domain}`);
      }

      // Verify cert was created
      return await this.checkCertificate(domain);
    } catch (error: any) {
      console.error(`[SSLService] Error issuing certificate:`, error);
      if (buildId) {
        await LogService.error(buildId, `SSL issuance error: ${error.message}`);
      }
      return {
        success: false,
        error: error.message,
      };
    }
  },

  /**
   * Check if a valid certificate exists for a domain.
   */
  async checkCertificate(domain: string): Promise<SSLResult> {
    const certDir = join(LETSENCRYPT_DIR, domain);
    const certPath = join(certDir, 'fullchain.pem');
    const keyPath = join(certDir, 'privkey.pem');

    // Use sudo test -f because /etc/letsencrypt directories are 0700 root
    const testCert = Bun.spawn(['sudo', 'test', '-f', certPath]);
    await testCert.exited;
    const testKey = Bun.spawn(['sudo', 'test', '-f', keyPath]);
    await testKey.exited;

    if (testCert.exitCode !== 0 || testKey.exitCode !== 0) {
      return { success: false, error: 'Certificate files not found' };
    }

    // Get cert expiry using openssl
    try {
      const expiry = await this.getCertExpiry(domain);
      return {
        success: true,
        certPath,
        keyPath,
        expiry,
      };
    } catch {
      // Files exist but can't read expiry — still consider it a success
      return { success: true, certPath, keyPath };
    }
  },

  /** Names a certificate covers, or null when it can't be read. */
  async getCertNames(domain: string): Promise<string[] | null> {
    const certPath = join(LETSENCRYPT_DIR, domain, 'fullchain.pem');
    try {
      const proc = Bun.spawn(
        ['sudo', 'openssl', 'x509', '-noout', '-ext', 'subjectAltName', '-in', certPath],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      return parseSanNames(output);
    } catch {
      return null;
    }
  },

  /**
   * Get the expiry date of a certificate.
   */
  async getCertExpiry(domain: string): Promise<Date | undefined> {
    const certPath = join(LETSENCRYPT_DIR, domain, 'fullchain.pem');

    try {
      const proc = Bun.spawn(['sudo', 'openssl', 'x509', '-enddate', '-noout', '-in', certPath], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      await proc.exited;

      if (proc.exitCode !== 0) return undefined;

      // Output format: notAfter=Sep 19 12:00:00 2026 GMT
      const match = output.match(/notAfter=(.+)/);
      if (match) {
        return new Date(match[1].trim());
      }
    } catch {
      return undefined;
    }

    return undefined;
  },

  /**
   * Revoke and delete a certificate for a domain.
   */
  async revokeCertificate(domain: string): Promise<SSLResult> {
    console.log(`[SSLService] Revoking certificate for ${domain}`);

    const certPath = join(LETSENCRYPT_DIR, domain, 'fullchain.pem');

    if (!existsSync(certPath)) {
      console.log(`[SSLService] No certificate found for ${domain}, nothing to revoke`);
      return { success: true };
    }

    try {
      // Revoke
      const revokeProc = Bun.spawn(
        [
          'sudo',
          'certbot',
          'revoke',
          '--cert-path',
          certPath,
          '--non-interactive',
          '--no-delete-after-revoke',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );

      const revokeStderr = await new Response(revokeProc.stderr).text();
      await revokeProc.exited;

      if (revokeProc.exitCode !== 0) {
        console.warn(`[SSLService] Revoke may have failed: ${revokeStderr}`);
        // Continue to delete anyway
      }

      // Delete the cert files
      const deleteProc = Bun.spawn(
        ['sudo', 'certbot', 'delete', '--cert-name', domain, '--non-interactive'],
        { stdout: 'pipe', stderr: 'pipe' },
      );

      await deleteProc.exited;

      console.log(`[SSLService] Certificate revoked and deleted for ${domain}`);
      return { success: true };
    } catch (error: any) {
      console.error(`[SSLService] Error revoking certificate:`, error);
      return { success: false, error: error.message };
    }
  },
};
