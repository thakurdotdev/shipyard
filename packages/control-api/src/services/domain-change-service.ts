import { config, getServerHost } from '@thakur-deploy/config';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db';
import { deployments, domainProvisions, projects } from '../db/schema';
import { CloudflareService } from './cloudflare-service';
import { DeploymentService } from './deployment-service';
import { DomainService, parseAliasRecords } from './domain-service';
import { isCustomDomain, normalizeDomainInput, siteNameFor } from './domain-names';
import { EventStreamService } from './event-stream-service';

const DEPLOY_ENGINE_URL = config.deployEngineUrl;

type Project = typeof projects.$inferSelect;
type ProvisionRow = typeof domainProvisions.$inferSelect;

export interface HostCheck {
  name: string;
  /** ours: already points here · missing: will be created · elsewhere: blocks the change */
  status: 'ours' | 'missing' | 'elsewhere' | 'unknown';
  detail?: string;
  proxied?: boolean;
}

export interface DomainCheck {
  domain: string;
  site: string;
  custom: boolean;
  www_redirect: boolean;
  zone: string | null;
  hosts: HostCheck[];
  /** Other Nginx sites on this server that serve these names and will be replaced. */
  replaces: { file: string; names: string[] }[];
  /** Anything here blocks the change. */
  errors: string[];
  warnings: string[];
}

export interface DomainSwitch {
  state: 'running' | 'done' | 'failed';
  domain: string;
  www_redirect: boolean;
  previous_domain: string | null;
  message: string;
  started_at: string;
  finished_at?: string;
}

/** In-flight and last finished domain change per project (lost on restart, like the job). */
const switches = new Map<string, DomainSwitch>();

function report(projectId: string, state: DomainSwitch) {
  switches.set(projectId, state);
  EventStreamService.broadcastDomainStatus(projectId, {
    project_id: projectId,
    step: state.state === 'running' ? 'domain_switching' : `domain_switch_${state.state}`,
    message: state.message,
  });
}

async function hostsInUse(projectId: string, hosts: string[]) {
  const others = await db
    .select({ name: projects.name, domain: projects.domain, www: projects.www_redirect })
    .from(projects)
    .where(ne(projects.id, projectId));
  const taken: string[] = [];
  for (const other of others) {
    if (!other.domain) continue;
    const otherHosts = [other.domain.toLowerCase()];
    if (other.www && isCustomDomain(other.domain)) otherHosts.push(`www.${other.domain}`);
    for (const host of hosts) {
      if (otherHosts.includes(host)) taken.push(`${host} is used by project "${other.name}"`);
    }
  }
  return taken;
}

export const DomainChangeService = {
  /** What changing to `input` would do, without changing anything. */
  async check(project: Project, input: string, wwwRedirect: boolean): Promise<DomainCheck> {
    const result: DomainCheck = {
      domain: input,
      site: '',
      custom: false,
      www_redirect: false,
      zone: null,
      hosts: [],
      replaces: [],
      errors: [],
      warnings: [],
    };
    try {
      result.domain = normalizeDomainInput(input);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      return result;
    }
    result.site = siteNameFor(result.domain);
    result.custom = isCustomDomain(result.domain);
    result.www_redirect = result.custom && wwwRedirect;
    const hosts = [result.domain, ...(result.www_redirect ? [`www.${result.domain}`] : [])];

    result.errors.push(...(await hostsInUse(project.id, hosts)));

    if (!CloudflareService.isConfigured()) {
      if (result.custom) {
        result.errors.push('Connect Cloudflare in Settings to use a custom domain.');
      } else {
        result.warnings.push(
          `Cloudflare isn't connected: ${result.domain} must already resolve to this server.`,
        );
      }
      result.hosts = hosts.map((name) => ({ name, status: 'unknown' }));
    } else {
      const serverIp = await getServerHost();
      for (const host of hosts) {
        try {
          const { zone, dns } = await CloudflareService.inspectHost(
            host,
            serverIp,
            host === result.domain ? undefined : result.domain,
          );
          result.zone ??= zone.name;
          if (dns.state === 'ours') {
            result.hosts.push({ name: host, status: 'ours', proxied: dns.proxied });
          } else if (dns.state === 'missing') {
            result.hosts.push({ name: host, status: 'missing' });
          } else {
            result.hosts.push({ name: host, status: 'elsewhere', detail: dns.detail });
            result.errors.push(
              `${host} points somewhere else (${dns.detail}). Change or remove that record in Cloudflare first.`,
            );
          }
        } catch (error) {
          result.hosts.push({ name: host, status: 'unknown' });
          result.errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    if (config.isProduction) {
      try {
        const res = await fetch(`${DEPLOY_ENGINE_URL}/nginx/conflicts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subdomain: result.site, aliases: hosts.slice(1) }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = (await res.json()) as { conflicts?: DomainCheck['replaces'] };
          result.replaces = data.conflicts ?? [];
        }
      } catch {
        // Informational only.
      }
      if (
        result.replaces.length &&
        !(await DomainService.certificateCovers(result.domain, hosts.slice(1)))
      ) {
        // Issuing one would mean switching that site off before this project is live.
        result.errors.push(
          `${result.domain} is served by another Nginx site and this server has no certificate covering ${hosts.join(' and ')}. Issue one first (e.g. certbot --nginx -d ${hosts.join(' -d ')}), then try again.`,
        );
      }
      for (const site of result.replaces) {
        result.warnings.push(
          `${site.names.join(', ')} is served by another Nginx site (${site.file}); it will be switched off when this project takes over, and kept in /etc/nginx/shipyard-replaced.`,
        );
      }
    }
    return result;
  },

  getSwitch(projectId: string): DomainSwitch | null {
    return switches.get(projectId) ?? null;
  },

  /**
   * Starts moving a project to a new domain. Returns once it is under way; follow it with
   * getSwitch(). The live site keeps serving the old domain until the new one answers.
   */
  async start(project: Project, input: string, wwwRedirect: boolean) {
    if (switches.get(project.id)?.state === 'running') {
      throw new Error('A domain change is already running for this project');
    }
    const check = await this.check(project, input, wwwRedirect);
    if (check.errors.length) throw new Error(check.errors.join(' '));
    if (
      check.domain === project.domain?.toLowerCase() &&
      check.www_redirect === project.www_redirect
    ) {
      return { started: false, check };
    }

    report(project.id, {
      state: 'running',
      domain: check.domain,
      www_redirect: check.www_redirect,
      previous_domain: project.domain,
      message: `Moving to ${check.domain}...`,
      started_at: new Date().toISOString(),
    });
    void this.run(project, check);
    return { started: true, check };
  },

  async run(project: Project, check: DomainCheck) {
    const previous = { domain: project.domain, www_redirect: project.www_redirect };
    const oldProvision = await DomainService.getByProjectId(project.id);
    const oldSite = previous.domain ? siteNameFor(previous.domain) : null;
    const base = switches.get(project.id)!;

    await db
      .update(projects)
      .set({ domain: check.domain, www_redirect: check.www_redirect, updated_at: new Date() })
      .where(eq(projects.id, project.id));

    try {
      const active = await db.query.deployments.findFirst({
        where: and(eq(deployments.project_id, project.id), eq(deployments.status, 'active')),
      });
      if (active && config.isProduction) {
        // Provisions the new domain and switches the site over; throws if it never answers.
        await DeploymentService.activateBuild(project.id, active.build_id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[DomainChange] Moving ${project.id} to ${check.domain} failed:`, error);
      await this.rollback(project.id, previous, oldProvision, check).catch((rollbackError) =>
        console.error('[DomainChange] Rollback failed:', rollbackError),
      );
      report(project.id, {
        ...base,
        state: 'failed',
        message: `Could not move to ${check.domain}: ${message}. ${previous.domain ?? 'The old domain'} is still live.`,
        finished_at: new Date().toISOString(),
      });
      return;
    }

    // The new domain is live: from here on, problems are cleanup, never a rollback.
    let cleanupNote = '';
    const newHosts = [check.domain, ...(check.www_redirect ? [`www.${check.domain}`] : [])];
    if (oldProvision && config.isProduction) {
      try {
        // Never remove the site that now serves the new domain, whatever the old record says.
        const sameSite = oldProvision.subdomain === check.site || oldSite === check.site;
        await this.retire(project.id, oldProvision, sameSite, newHosts);
      } catch (error) {
        console.error('[DomainChange] Cleaning up the old domain failed:', error);
        cleanupNote = ` (cleaning up ${previous.domain} failed: ${error instanceof Error ? error.message : error})`;
      }
    }
    const live = await db.query.deployments.findFirst({
      where: and(eq(deployments.project_id, project.id), eq(deployments.status, 'active')),
    });
    report(project.id, {
      ...base,
      state: 'done',
      message:
        (live
          ? `Live on ${check.domain}`
          : `Saved. ${check.domain} is set up on the next deploy.`) + cleanupNote,
      finished_at: new Date().toISOString(),
    });
  },

  /** Takes down what only the old domain used, once the new one is live. */
  async retire(
    projectId: string,
    oldProvision: ProvisionRow,
    sameSite: boolean,
    newHosts: string[],
  ) {
    if (!sameSite) {
      // Removes the old site, plus the DNS records and certificate ShipYard created for it.
      await DomainService.deprovision(projectId, oldProvision);
      return;
    }
    // Same site, www switched off: drop the www record if ShipYard created it.
    for (const alias of parseAliasRecords(oldProvision.alias_records)) {
      if (!alias.owned || !alias.id || newHosts.includes(alias.name)) continue;
      await CloudflareService.deleteARecord(alias.id, alias.zoneId).catch((error) =>
        console.warn(`[DomainChange] Could not delete DNS record ${alias.name}:`, error.message),
      );
    }
  },

  /** Puts the project's domain and provisioning record back as they were. */
  async rollback(
    projectId: string,
    previous: { domain: string | null; www_redirect: boolean },
    oldProvision: ProvisionRow | null,
    check: DomainCheck,
  ) {
    await db
      .update(projects)
      .set({ ...previous, updated_at: new Date() })
      .where(eq(projects.id, projectId));

    const current = await DomainService.getByProjectId(projectId);
    // A config written for the new name (the HTTP-only one for its certificate) goes too,
    // unless that name was taken over from another site: then it stays as it is.
    if (current && current.subdomain !== oldProvision?.subdomain && check.replaces.length === 0) {
      await fetch(`${DEPLOY_ENGINE_URL}/nginx/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: current.subdomain }),
      }).catch(() => {});
    }
    if (current && current.full_domain !== oldProvision?.full_domain) {
      // DNS records created for the new domain go; the engine already restored Nginx.
      if (current.dns_record_id && current.dns_record_owned) {
        await CloudflareService.deleteARecord(current.dns_record_id, current.dns_zone_id).catch(
          () => {},
        );
      }
      for (const alias of parseAliasRecords(current.alias_records)) {
        if (alias.owned && alias.id) {
          await CloudflareService.deleteARecord(alias.id, alias.zoneId).catch(() => {});
        }
      }
    }
    if (oldProvision) {
      const { id, project_id: _projectId, created_at: _createdAt, ...fields } = oldProvision;
      await db
        .update(domainProvisions)
        .set({ ...fields, updated_at: new Date() })
        .where(eq(domainProvisions.id, id));
    } else if (current) {
      await db.delete(domainProvisions).where(eq(domainProvisions.id, current.id));
    }
  },
};
