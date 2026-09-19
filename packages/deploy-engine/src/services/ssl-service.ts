import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';

const CERTBOT_WEBROOT = process.env.CERTBOT_WEBROOT || '/var/www/certbot';
const CERTBOT_EMAIL = process.env.CERTBOT_EMAIL || 'admin@thakur.dev';
const LETSENCRYPT_DIR = '/etc/letsencrypt/live';

interface SSLResult {
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
  async issueCertificate(domain: string): Promise<SSLResult> {
    console.log(`[SSLService] Issuing certificate for ${domain}`);

    // Check if cert already exists
    const existing = await this.checkCertificate(domain);
    if (existing.success && existing.certPath) {
      console.log(`[SSLService] Certificate already exists for ${domain}`);
      return existing;
    }

    // Ensure webroot directory exists and is readable by Nginx
    if (!existsSync(CERTBOT_WEBROOT)) {
      const mkdirProc = Bun.spawn(['sudo', 'mkdir', '-p', CERTBOT_WEBROOT]);
      await mkdirProc.exited;
    }
    const chmodProc = Bun.spawn(['sudo', 'chmod', '-R', '755', CERTBOT_WEBROOT]);
    await chmodProc.exited;

    try {
      const args = [
        'sudo',
        'certbot',
        'certonly',
        '--webroot',
        '-w',
        CERTBOT_WEBROOT,
        '-d',
        domain,
        '--non-interactive',
        '--agree-tos',
        '--email',
        CERTBOT_EMAIL,
        '--no-eff-email',
        // Force renewal if cert exists but is invalid
        '--force-renewal',
      ];

      console.log(`[SSLService] Running: ${args.join(' ')}`);

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
        return {
          success: false,
          error: `certbot failed: ${stderr || stdout}`.slice(0, 500),
        };
      }

      console.log(`[SSLService] Certificate issued successfully for ${domain}`);
      console.log(`[SSLService] stdout: ${stdout}`);

      // Verify cert was created
      return await this.checkCertificate(domain);
    } catch (error: any) {
      console.error(`[SSLService] Error issuing certificate:`, error);
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

    if (!existsSync(certPath) || !existsSync(keyPath)) {
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

  /**
   * Get the expiry date of a certificate.
   */
  async getCertExpiry(domain: string): Promise<Date | undefined> {
    const certPath = join(LETSENCRYPT_DIR, domain, 'fullchain.pem');

    if (!existsSync(certPath)) return undefined;

    try {
      const proc = Bun.spawn(['openssl', 'x509', '-enddate', '-noout', '-in', certPath], {
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
