import { config, getServerHost } from '@thakur-deploy/config';
import { promises as dnsPromises } from 'dns';
import { db } from '../db';
import { domainProvisions, projects } from '../db/schema';
import type { DomainDnsStatus, DomainSslStatus } from '../db/schema';
import { eq } from 'drizzle-orm';
import { CloudflareService } from './cloudflare-service';
import { GateService } from './gate-service';
import {
  domainForSite,
  parseAliasRecords,
  provisionMatches,
  type AliasRecord,
} from './domain-names';
import { deployEngineFetch } from './deploy-engine-client';

export { domainForSite, parseAliasRecords, provisionMatches, type AliasRecord };

const BASE_DOMAIN = config.baseDomain;

type ProvisionRow = typeof domainProvisions.$inferSelect;

/**
 * DomainService orchestrates the full DNS + SSL provisioning lifecycle:
 *
 * 1. Point the domain (and www, for a custom domain) here in Cloudflare. Records that
 *    already do are reused untouched; missing ones are created DNS-only.
 * 2. Create temporary HTTP-only nginx config (only when a certificate must be issued)
 * 3. Issue (or reuse) the Let's Encrypt certificate via certbot webroot
 * 4. Upgrade nginx config to full HTTPS (left to the activation when it follows)
 * 5. Switch records ShipYard created to proxied mode (orange cloud)
 *
 * Domain provisions are tracked in the `domain_provisions` table and
 * are independent of individual deployments — a domain is provisioned
 * once and reused across deployments.
 */
export const DomainService = {
  /**
   * Provision a domain for a project: DNS → SSL → Nginx.
   * `site` is the engine's site name: a subdomain label, or a custom domain's hostname.
   * With `deferNginx`, the caller (an activation) writes the final site config itself,
   * so an existing site for the same domain keeps serving until that single switch.
   */
  async provision(
    projectId: string,
    site: string,
    port: number | null,
    onStatus?: (step: string, message: string) => Promise<void>,
    buildId?: string,
    options: { aliases?: string[]; deferNginx?: boolean } = {},
  ): Promise<{
    success: boolean;
    provisionId?: string;
    fullDomain?: string;
    error?: string;
    failedAtStep?: string;
  }> {
    const fullDomain = domainForSite(site);
    const aliases = options.aliases ?? [];
    const names = [fullDomain, ...aliases];
    const notify = onStatus || (async () => {});
    const serverHost = await getServerHost();
    // Protected sites must never be served unauthenticated, even briefly while the domain is set up.
    const gated = await GateService.isEnabled(projectId);

    console.log(
      `[DomainService] Starting provision for ${names.join(', ')} (project: ${projectId})`,
    );

    const existing = await this.getByProjectId(projectId);
    const matches = existing ? provisionMatches(existing, fullDomain, aliases) : false;
    if (
      existing &&
      matches &&
      (existing.dns_status === 'created' || existing.dns_status === 'proxied') &&
      existing.ssl_status === 'issued'
    ) {
      console.log(`[DomainService] Domain ${fullDomain} already fully provisioned`);
      return { success: true, provisionId: existing.id, fullDomain };
    }

    // Create or update provision record
    let provision: ProvisionRow;
    if (existing && !matches) {
      // A different domain (or www setting) than last time: start over for this one.
      const [reset] = await db
        .update(domainProvisions)
        .set({
          subdomain: site,
          full_domain: fullDomain,
          server_ip: serverHost,
          dns_record_id: null,
          dns_zone_id: null,
          dns_record_owned: true,
          alias_records: null,
          dns_status: 'pending',
          ssl_status: 'pending',
          ssl_cert_path: null,
          ssl_expiry: null,
          ssl_reused: false,
          error_message: null,
          updated_at: new Date(),
        })
        .where(eq(domainProvisions.id, existing.id))
        .returning();
      provision = reset;
    } else if (existing) {
      // Same domain, unfinished: retry the missing steps.
      const [updated] = await db
        .update(domainProvisions)
        .set({
          subdomain: site,
          server_ip: serverHost,
          error_message: null,
          updated_at: new Date(),
        })
        .where(eq(domainProvisions.id, existing.id))
        .returning();
      provision = updated;
    } else {
      const [created] = await db
        .insert(domainProvisions)
        .values({
          project_id: projectId,
          subdomain: site,
          full_domain: fullDomain,
          server_ip: serverHost,
          dns_status: 'pending',
          ssl_status: 'pending',
        })
        .returning();
      provision = created;
    }

    // ──────────────────────────────────────────────
    // Step 1: DNS: the domain (and www) must point here
    // ──────────────────────────────────────────────
    if (
      provision.dns_status !== 'created' &&
      provision.dns_status !== 'proxied' &&
      !CloudflareService.isConfigured()
    ) {
      // No Cloudflare: the domain must already resolve here (e.g. a *.<base domain> record).
      await db
        .update(domainProvisions)
        .set({
          dns_status: 'created',
          alias_records: JSON.stringify(
            aliases.map((name) => ({ name, id: null, zoneId: null, owned: false })),
          ),
          updated_at: new Date(),
        })
        .where(eq(domainProvisions.id, provision.id));
      provision.dns_status = 'created';
      await notify(
        'dns_created',
        `Cloudflare isn't connected; expecting ${names.join(' and ')} to resolve to ${serverHost} already.`,
      );
    }

    let aliasRecords = parseAliasRecords(provision.alias_records);
    if (provision.dns_status !== 'created' && provision.dns_status !== 'proxied') {
      await notify('dns_creating', `Pointing ${names.join(' and ')} at this server...`);
      await this.updateDnsStatus(provision.id, 'creating');

      try {
        const primary = await CloudflareService.ensureHost(fullDomain, serverHost);
        aliasRecords = [];
        for (const alias of aliases) {
          // www may be its own A record or a CNAME to the domain.
          const record = await CloudflareService.ensureHost(alias, serverHost, fullDomain);
          aliasRecords.push({
            name: alias,
            id: record.recordId,
            zoneId: record.zoneId,
            owned: record.owned,
          });
        }

        await db
          .update(domainProvisions)
          .set({
            dns_record_id: primary.recordId,
            dns_zone_id: primary.zoneId,
            dns_record_owned: primary.owned,
            alias_records: JSON.stringify(aliasRecords),
            dns_status: primary.proxied ? 'proxied' : 'created',
            updated_at: new Date(),
          })
          .where(eq(domainProvisions.id, provision.id));

        provision.dns_record_id = primary.recordId;
        provision.dns_zone_id = primary.zoneId;
        provision.dns_record_owned = primary.owned;
        provision.dns_status = primary.proxied ? 'proxied' : 'created';

        await notify(
          'dns_created',
          primary.owned
            ? `DNS A record created: ${fullDomain} → ${serverHost}`
            : `${fullDomain} already points to this server; keeping its DNS record as is`,
        );
        console.log(`[DomainService] DNS ready for ${names.join(', ')}`);
      } catch (error: any) {
        console.error(`[DomainService] DNS setup failed:`, error);
        await this.markError(provision.id, 'dns', error.message);
        return { success: false, error: error.message, failedAtStep: 'dns_creating' };
      }
    } else {
      await notify('dns_created', `DNS record already exists for ${fullDomain}`);
    }

    // ──────────────────────────────────────────────
    // Steps 2-4: certificate (reused when one already covers every name)
    // ──────────────────────────────────────────────
    if (provision.ssl_status !== 'issued') {
      const covered = await this.certificateCovers(fullDomain, aliases);

      if (!covered) {
        // Let's Encrypt validates over plain HTTP on this server.
        try {
          await notify('nginx_configuring', `Setting up HTTP config for ACME validation...`);
          const httpConfigRes = await deployEngineFetch(`/nginx/http-only`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subdomain: site, port, gated, aliases }),
          });

          if (!httpConfigRes.ok) {
            const err = await httpConfigRes.text();
            throw new Error(`Failed to configure HTTP proxy for ACME validation: ${err}`);
          }
        } catch (error: any) {
          console.error(`[DomainService] HTTP-only nginx config failed:`, error.message);
          await this.markError(provision.id, 'ssl', error.message);
          return { success: false, error: error.message, failedAtStep: 'nginx_configuring' };
        }

        await notify('ssl_issuing', `Waiting for DNS propagation for ${fullDomain}...`);
        await this.waitForDns(fullDomain);
      }

      await notify('ssl_issuing', `Issuing SSL certificate for ${names.join(', ')}...`);
      await this.updateSslStatus(provision.id, 'issuing');

      try {
        const sslRes = await deployEngineFetch(`/ssl/issue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: fullDomain, buildId, aliases }),
        });

        if (!sslRes.ok) {
          const errorData = await sslRes.json().catch(() => ({ error: 'SSL issuance failed' }));
          throw new Error((errorData as any).error || 'SSL issuance failed');
        }

        const sslResult = (await sslRes.json()) as {
          success: boolean;
          reused?: boolean;
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
            ssl_reused: Boolean(sslResult.reused),
            ssl_cert_path:
              sslResult.certPath || `/etc/letsencrypt/live/${fullDomain}/fullchain.pem`,
            ssl_expiry: sslResult.expiry ? new Date(sslResult.expiry) : null,
            updated_at: new Date(),
          })
          .where(eq(domainProvisions.id, provision.id));

        provision.ssl_status = 'issued';
        await notify(
          'ssl_issued',
          sslResult.reused
            ? `Using the existing SSL certificate for ${fullDomain}`
            : `SSL certificate issued for ${fullDomain}`,
        );
        console.log(`[DomainService] SSL cert ready for ${fullDomain}`);
      } catch (error: any) {
        console.error(`[DomainService] SSL issuance failed:`, error);
        await this.markError(provision.id, 'ssl', error.message);
        return { success: false, error: error.message, failedAtStep: 'ssl_issuing' };
      }
    } else {
      await notify('ssl_issued', `SSL certificate already exists for ${fullDomain}`);
    }

    // ──────────────────────────────────────────────
    // Step 5: Upgrade nginx to full HTTPS (an activation does this itself)
    // ──────────────────────────────────────────────
    if (!options.deferNginx) {
      try {
        await notify('nginx_configuring', `Configuring HTTPS reverse proxy...`);

        const nginxRes = await deployEngineFetch(`/nginx/upgrade-https`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subdomain: site, port, gated, aliases }),
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
    }

    // ──────────────────────────────────────────────
    // Step 6: Switch records ShipYard created to proxied (orange cloud)
    // ──────────────────────────────────────────────
    if (
      provision.dns_record_id &&
      provision.dns_record_owned &&
      provision.dns_status !== 'proxied'
    ) {
      try {
        await CloudflareService.updateProxyMode(
          provision.dns_record_id,
          true,
          provision.dns_zone_id,
        );
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
    for (const alias of aliasRecords) {
      if (!alias.owned || !alias.id) continue;
      await CloudflareService.updateProxyMode(alias.id, true, alias.zoneId).catch((error) =>
        console.warn(`[DomainService] Failed to proxy ${alias.name}:`, error.message),
      );
    }

    console.log(`[DomainService] Domain ${fullDomain} fully provisioned`);
    return { success: true, provisionId: provision.id, fullDomain };
  },

  /** Whether the server already holds a certificate for every name. */
  async certificateCovers(domain: string, aliases: string[]): Promise<boolean> {
    try {
      const query = new URLSearchParams({ domain, aliases: aliases.join(',') });
      const res = await deployEngineFetch(`/ssl/status?${query}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { covered?: boolean };
      return data.covered === true;
    } catch {
      return false;
    }
  },

  async waitForDns(fullDomain: string) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const addresses = await dnsPromises.resolve4(fullDomain);
        if (addresses && addresses.length > 0) return;
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    console.warn(`[DomainService] DNS for ${fullDomain} not yet resolved locally, proceeding...`);
  },

  /**
   * Removes what ShipYard set up for a domain: its site, the DNS records and certificate
   * ShipYard created. Records and certificates it found already in place are kept.
   */
  async deprovision(projectId: string, row?: ProvisionRow | null): Promise<void> {
    const provision = row ?? (await this.getByProjectId(projectId));
    if (!provision) {
      console.log(`[DomainService] No domain provision found for project ${projectId}`);
      return;
    }

    console.log(`[DomainService] Deprovisioning domain ${provision.full_domain}`);

    // 1. Delete the DNS records ShipYard created
    if (provision.dns_record_id && provision.dns_record_owned) {
      try {
        await CloudflareService.deleteARecord(provision.dns_record_id, provision.dns_zone_id);
      } catch (error: any) {
        console.warn(`[DomainService] Failed to delete DNS record:`, error.message);
      }
    }
    for (const alias of parseAliasRecords(provision.alias_records)) {
      if (!alias.owned || !alias.id) continue;
      await CloudflareService.deleteARecord(alias.id, alias.zoneId).catch((error) =>
        console.warn(`[DomainService] Failed to delete DNS record ${alias.name}:`, error.message),
      );
    }

    // 2. Revoke the certificate, unless it was one ShipYard found and reused
    if (!provision.ssl_reused && provision.ssl_status === 'issued') {
      try {
        await deployEngineFetch(`/ssl/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: provision.full_domain }),
        });
      } catch (error: any) {
        console.warn(`[DomainService] Failed to revoke SSL cert:`, error.message);
      }
    }

    // 3. Remove nginx config
    try {
      await deployEngineFetch(`/nginx/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: provision.subdomain }),
      });
    } catch (error: any) {
      console.warn(`[DomainService] Failed to remove nginx config:`, error.message);
    }

    // 4. Update DB record
    if (!row) {
      await db
        .update(domainProvisions)
        .set({ dns_status: 'deleted', updated_at: new Date() })
        .where(eq(domainProvisions.id, provision.id));
    }

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
    port: number | null,
    onStatus?: (step: string, message: string) => Promise<void>,
    aliases: string[] = [],
    /** The project's current site; defaults to the one last provisioned. */
    site?: string,
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
    return this.provision(projectId, site ?? provision.subdomain, port, onStatus, undefined, {
      aliases,
    });
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
