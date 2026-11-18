import { config } from '@thakur-deploy/config';

/**
 * Names for a project's public domain.
 *
 * A project lives either on a subdomain of the base domain (`app.example.com`), or on a
 * custom domain from the same Cloudflare account (`example.com`, `shop.example.org`).
 * The deploy engine names each site after it: the label for a subdomain (keeping the
 * config file names it always had) and the full hostname for a custom domain.
 */

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Labels the platform keeps for itself (kept in sync with the deploy engine). */
export const RESERVED_LABELS = [
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
  'ftp',
  'localhost',
];

function dashboardHost(): string {
  try {
    return new URL(config.publicUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** The engine's site name for a domain: the label of a subdomain, else the hostname. */
export function siteNameFor(domain: string, base = config.baseDomain): string {
  const host = domain.toLowerCase();
  if (host.endsWith(`.${base}`)) {
    const label = host.slice(0, -(base.length + 1));
    if (!label.includes('.')) return label;
  }
  return host;
}

/** Whether a domain is a custom domain (not a plain subdomain of the base domain). */
export function isCustomDomain(domain: string, base = config.baseDomain): boolean {
  return siteNameFor(domain, base).includes('.');
}

/** Redirect-only names for a project: `www.<domain>` when enabled on a custom domain. */
export function domainAliases(
  project: { domain: string | null; www_redirect?: boolean | null },
  base = config.baseDomain,
): string[] {
  if (!project.domain || !project.www_redirect || !isCustomDomain(project.domain, base)) {
    return [];
  }
  return [`www.${project.domain.toLowerCase()}`];
}

/** Every hostname a project answers for, its own domain first. */
export function projectHosts(project: { domain: string | null; www_redirect?: boolean | null }) {
  return project.domain ? [project.domain.toLowerCase(), ...domainAliases(project)] : [];
}

/**
 * Turns what a person typed (`app`, `https://Example.com/`, `example.com.`) into a
 * domain, or throws a message that can be shown as is.
 */
export function normalizeDomainInput(input: string, base = config.baseDomain): string {
  let value = input.trim().toLowerCase();
  value = value
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
  if (!value) throw new Error('Enter a domain');
  if (value.includes(':')) throw new Error('Leave out the port: just the domain name');

  if (!value.includes('.')) {
    if (!LABEL.test(value)) {
      throw new Error('Use letters, numbers and hyphens for a subdomain');
    }
    if (RESERVED_LABELS.includes(value)) throw new Error(`"${value}" is reserved`);
    return `${value}.${base}`;
  }

  if (!HOSTNAME.test(value)) throw new Error(`"${value}" is not a valid domain name`);
  if (value === dashboardHost()) throw new Error('That domain is the ShipYard dashboard');
  if (value.startsWith('www.')) {
    throw new Error('Use the domain without "www." and turn on the www redirect instead');
  }
  const site = siteNameFor(value, base);
  if (!site.includes('.') && RESERVED_LABELS.includes(site)) {
    throw new Error(`"${site}" is reserved`);
  }
  return value;
}

export interface AliasRecord {
  name: string;
  id: string | null;
  zoneId: string | null;
  owned: boolean;
}

export function parseAliasRecords(text: string | null | undefined): AliasRecord[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as AliasRecord[]) : [];
  } catch {
    return [];
  }
}

/** The hostname for an engine site name: a label lives under the base domain. */
export function domainForSite(site: string): string {
  return site.includes('.') ? site : `${site}.${config.baseDomain}`;
}

/** Whether a provision row is for exactly this domain and set of redirect names. */
export function provisionMatches(
  row: { full_domain: string; alias_records: string | null },
  fullDomain: string,
  aliases: string[],
): boolean {
  if (row.full_domain !== fullDomain) return false;
  const have = parseAliasRecords(row.alias_records)
    .map((a) => a.name)
    .sort();
  const want = [...aliases].sort();
  return have.length === want.length && have.every((name, i) => name === want[i]);
}

/** What a hostname's DNS looks like from ShipYard's point of view. */
export type HostDnsState =
  | { state: 'missing' }
  | { state: 'ours'; recordId: string; proxied: boolean; via: 'A' | 'CNAME' }
  | { state: 'elsewhere'; detail: string };

/**
 * Decides whether existing records already send a hostname to this server.
 * `cnameTarget` is the one CNAME accepted (www -> the domain itself).
 */
export function classifyHostRecords(
  records: { id: string; type: string; content: string; proxied: boolean }[],
  serverIp: string,
  cnameTarget?: string,
): HostDnsState {
  const relevant = records.filter((r) => ['A', 'AAAA', 'CNAME'].includes(r.type));
  if (relevant.length === 0) return { state: 'missing' };
  const cname = relevant.find((r) => r.type === 'CNAME');
  if (cname) {
    const target = cname.content.toLowerCase().replace(/\.$/, '');
    return cnameTarget && target === cnameTarget.toLowerCase()
      ? { state: 'ours', recordId: cname.id, proxied: cname.proxied, via: 'CNAME' }
      : { state: 'elsewhere', detail: `CNAME to ${cname.content}` };
  }
  const foreign = relevant.filter((r) => !(r.type === 'A' && r.content === serverIp));
  if (foreign.length) {
    return {
      state: 'elsewhere',
      detail: foreign.map((r) => `${r.type} ${r.content}`).join(', '),
    };
  }
  const own = relevant[0];
  return { state: 'ours', recordId: own.id, proxied: own.proxied, via: 'A' };
}
