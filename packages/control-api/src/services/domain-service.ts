import { db } from '../db';
import { domainProvisions, projects } from '../db/schema';
import type { DomainDnsStatus, DomainSslStatus } from '../db/schema';
import { eq } from 'drizzle-orm';
import { CloudflareService } from './cloudflare-service';

const DEPLOY_ENGINE_URL = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';
const SERVER_HOST = process.env.SERVER_HOST || '127.0.0.1';
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'thakur.dev';

/**
 * DomainService orchestrates the full DNS + SSL provisioning lifecycle:
 *
 * 1. Create Cloudflare A record (grey cloud / DNS-only)
 * 2. Create temporary HTTP-only nginx config (for ACME challenge serving)
 * 3. Issue Let's Encrypt SSL certificate via certbot webroot
 * 4. Upgrade nginx config to full HTTPS
 * 5. Switch Cloudflare to proxied mode (orange cloud)
 *
 * Domain provisions are tracked in the `domain_provisions` table and
 * are independent of individual deployments — a domain is provisioned
 * once and reused across deployments.
 */
export const DomainService = {
  /**
   * Provision a domain for a project: DNS → SSL → Nginx.
   * Broadcasts status updates via the provided callback.
   */
  async provision(
    projectId: string,
    subdomain: string,
    port: number,
    onStatus?: (step: string, message: string) => Promise<void>,
  ): Promise<{
    success: boolean;
    provisionId?: string;
    fullDomain?: string;
    error?: string;
    failedAtStep?: string;
  }> {
    const fullDomain = `${subdomain}.${BASE_DOMAIN}`;
    const notify = onStatus || (async () => {});

    console.log(`[DomainService] Starting provision for ${fullDomain} (project: ${projectId})`);

    // Check if already provisioned
    const existing = await this.getByProjectId(projectId);
    if (existing && existing.dns_status === 'created' && existing.ssl_status === 'issued') {
      console.log(`[DomainService] Domain ${fullDomain} already fully provisioned`);
      return { success: true, provisionId: existing.id, fullDomain };
    }
    if (existing && existing.dns_status === 'proxied' && existing.ssl_status === 'issued') {
      console.log(`[DomainService] Domain ${fullDomain} already fully provisioned (proxied)`);
      return { success: true, provisionId: existing.id, fullDomain };
    }

    // Create or update provision record
    let provision: any;
    if (existing) {
      // Update existing record for retry
      await db
        .update(domainProvisions)
        .set({
          subdomain,
          full_domain: fullDomain,
          server_ip: SERVER_HOST,
          error_message: null,
          updated_at: new Date(),
        })
        .where(eq(domainProvisions.id, existing.id));
      provision = { ...existing, subdomain, full_domain: fullDomain };
    } else {
      const [created] = await db
        .insert(domainProvisions)
        .values({
          project_id: projectId,
          subdomain,
          full_domain: fullDomain,
          server_ip: SERVER_HOST,
          dns_status: 'pending',
          ssl_status: 'pending',
        })
        .returning();
      provision = created;
    }

    // ──────────────────────────────────────────────
    // Step 1: Create Cloudflare A record (grey cloud)
    // ──────────────────────────────────────────────
    if (provision.dns_status !== 'created' && provision.dns_status !== 'proxied') {
      await notify('dns_creating', `Creating DNS A record for ${fullDomain}...`);
      await this.updateDnsStatus(provision.id, 'creating');

      try {
        const { recordId } = await CloudflareService.createARecord(subdomain, SERVER_HOST);

        await db
          .update(domainProvisions)
          .set({
            dns_record_id: recordId,
            dns_status: 'created',
            updated_at: new Date(),
          })
          .where(eq(domainProvisions.id, provision.id));

        provision.dns_record_id = recordId;
        provision.dns_status = 'created';

        await notify('dns_created', `DNS A record created: ${fullDomain} → ${SERVER_HOST}`);
        console.log(`[DomainService] DNS record created: ${fullDomain} (ID: ${recordId})`);
      } catch (error: any) {
        console.error(`[DomainService] DNS creation failed:`, error);
        await this.markError(provision.id, 'dns', error.message);
        return { success: false, error: error.message, failedAtStep: 'dns_creating' };
      }
    } else {
      await notify('dns_created', `DNS record already exists for ${fullDomain}`);
    }

    // ──────────────────────────────────────────────
    // Step 2: Create HTTP-only nginx config for ACME
    // ──────────────────────────────────────────────
    try {
      await notify('nginx_configuring', `Setting up HTTP config for ACME validation...`);
      const httpConfigRes = await fetch(`${DEPLOY_ENGINE_URL}/nginx/http-only`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, port }),
      });

      if (!httpConfigRes.ok) {
        // Non-fatal — certbot might still work if nginx is already configured
        console.warn(`[DomainService] HTTP-only nginx config failed, continuing...`);
      }
    } catch (error: any) {
      console.warn(`[DomainService] HTTP-only nginx config failed:`, error.message);
      // Non-fatal
    }

    // ──────────────────────────────────────────────
    // Step 3: Wait for DNS propagation (brief delay)
    // ──────────────────────────────────────────────
    await notify('ssl_issuing', `Waiting for DNS propagation...`);
    await new Promise((r) => setTimeout(r, 5000)); // 5s initial delay

    // ──────────────────────────────────────────────
    // Step 4: Issue SSL certificate via Let's Encrypt
    // ──────────────────────────────────────────────
    if (provision.ssl_status !== 'issued') {
      await notify('ssl_issuing', `Issuing SSL certificate for ${fullDomain}...`);
      await this.updateSslStatus(provision.id, 'issuing');

      try {
        const sslRes = await fetch(`${DEPLOY_ENGINE_URL}/ssl/issue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: fullDomain }),
        });

        if (!sslRes.ok) {
          const errorData = await sslRes.json().catch(() => ({ error: 'SSL issuance failed' }));
          throw new Error((errorData as any).error || 'SSL issuance failed');
        }

        const sslResult = (await sslRes.json()) as {
          success: boolean;
          certPath?: string;
          expiry?: string;
          error?: string;
        };

        if (!sslResult.success) {
          throw new Error(sslResult.error || 'SSL issuance returned failure');
        }

        await db
          .update(domainProvisions)
          .set({
            ssl_status: 'issued',
            ssl_cert_path:
              sslResult.certPath || `/etc/letsencrypt/live/${fullDomain}/fullchain.pem`,
            ssl_expiry: sslResult.expiry ? new Date(sslResult.expiry) : null,
            updated_at: new Date(),
          })
          .where(eq(domainProvisions.id, provision.id));

        provision.ssl_status = 'issued';
        await notify('ssl_issued', `SSL certificate issued for ${fullDomain}`);
        console.log(`[DomainService] SSL cert issued for ${fullDomain}`);
      } catch (error: any) {
        console.error(`[DomainService] SSL issuance failed:`, error);
        await this.markError(provision.id, 'ssl', error.message);
        return { success: false, error: error.message, failedAtStep: 'ssl_issuing' };
      }
    } else {
      await notify('ssl_issued', `SSL certificate already exists for ${fullDomain}`);
    }

    // ──────────────────────────────────────────────
    // Step 5: Upgrade nginx to full HTTPS
    // ──────────────────────────────────────────────
    try {
      await notify('nginx_configuring', `Configuring HTTPS reverse proxy...`);

      const nginxRes = await fetch(`${DEPLOY_ENGINE_URL}/nginx/upgrade-https`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, port }),
      });

      if (!nginxRes.ok) {
        const err = await nginxRes.text();
        throw new Error(`Nginx HTTPS upgrade failed: ${err}`);
      }

      await notify('nginx_configured', `HTTPS reverse proxy configured for ${fullDomain}`);
    } catch (error: any) {
      console.error(`[DomainService] Nginx HTTPS upgrade failed:`, error);
      await this.markError(provision.id, 'ssl', error.message);
      return { success: false, error: error.message, failedAtStep: 'nginx_configuring' };
    }

    // ──────────────────────────────────────────────
    // Step 6: Switch Cloudflare to proxied (orange cloud)
    // ──────────────────────────────────────────────
    if (provision.dns_record_id && provision.dns_status !== 'proxied') {
      try {
        await CloudflareService.updateProxyMode(provision.dns_record_id, true);

        await db
          .update(domainProvisions)
          .set({ dns_status: 'proxied', updated_at: new Date() })
          .where(eq(domainProvisions.id, provision.id));

        console.log(`[DomainService] Cloudflare switched to proxied mode for ${fullDomain}`);
      } catch (error: any) {
        // Non-fatal — DNS works, just won't have CDN/DDoS protection
        console.warn(`[DomainService] Failed to enable Cloudflare proxy:`, error.message);
      }
    }

    console.log(`[DomainService] Domain ${fullDomain} fully provisioned`);
    return { success: true, provisionId: provision.id, fullDomain };
  },

  /**
   * Deprovision a domain: remove DNS record, revoke SSL, delete nginx config.
   */
  async deprovision(projectId: string): Promise<void> {
    const provision = await this.getByProjectId(projectId);
    if (!provision) {
      console.log(`[DomainService] No domain provision found for project ${projectId}`);
      return;
    }

    console.log(`[DomainService] Deprovisioning domain ${provision.full_domain}`);

    // 1. Delete Cloudflare DNS record
    if (provision.dns_record_id) {
      try {
        await CloudflareService.deleteARecord(provision.dns_record_id);
      } catch (error: any) {
        console.warn(`[DomainService] Failed to delete DNS record:`, error.message);
      }
    }

    // 2. Revoke SSL certificate
    try {
      await fetch(`${DEPLOY_ENGINE_URL}/ssl/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: provision.full_domain }),
      });
    } catch (error: any) {
      console.warn(`[DomainService] Failed to revoke SSL cert:`, error.message);
    }

    // 3. Remove nginx config
    try {
      // This is handled by DeployService.deleteProject() via NginxService.removeConfig()
      // But we ensure it's called here too for standalone deprovision
      const nginxRes = await fetch(`${DEPLOY_ENGINE_URL}/nginx/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: provision.subdomain }),
      });
    } catch (error: any) {
      console.warn(`[DomainService] Failed to remove nginx config:`, error.message);
    }

    // 4. Update DB record
    await db
      .update(domainProvisions)
      .set({
        dns_status: 'deleted',
        updated_at: new Date(),
      })
      .where(eq(domainProvisions.id, provision.id));

    console.log(`[DomainService] Domain ${provision.full_domain} deprovisioned`);
  },

  /**
   * Get domain provision status for a project.
   */
  async getByProjectId(projectId: string) {
    const [provision] = await db
      .select()
      .from(domainProvisions)
      .where(eq(domainProvisions.project_id, projectId));
    return provision || null;
  },

  /**
   * Retry a failed provision from the failed step.
   */
  async retry(
    projectId: string,
    port: number,
    onStatus?: (step: string, message: string) => Promise<void>,
  ) {
    const provision = await this.getByProjectId(projectId);
    if (!provision) {
      throw new Error('No domain provision found for this project');
    }

    // Reset error state
    await db
      .update(domainProvisions)
      .set({ error_message: null, updated_at: new Date() })
      .where(eq(domainProvisions.id, provision.id));

    // Re-run provision — it will skip already-completed steps
    return this.provision(projectId, provision.subdomain, port, onStatus);
  },

  // ─── Helpers ────────────────────────────────────

  async updateDnsStatus(provisionId: string, status: DomainDnsStatus) {
    await db
      .update(domainProvisions)
      .set({ dns_status: status, updated_at: new Date() })
      .where(eq(domainProvisions.id, provisionId));
  },

  async updateSslStatus(provisionId: string, status: DomainSslStatus) {
    await db
      .update(domainProvisions)
      .set({ ssl_status: status, updated_at: new Date() })
      .where(eq(domainProvisions.id, provisionId));
  },

  async markError(provisionId: string, type: 'dns' | 'ssl', message: string) {
    const update: any = { error_message: message, updated_at: new Date() };
    if (type === 'dns') update.dns_status = 'failed';
    if (type === 'ssl') update.ssl_status = 'failed';

    await db.update(domainProvisions).set(update).where(eq(domainProvisions.id, provisionId));
  },
};
