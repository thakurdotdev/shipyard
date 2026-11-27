import { config, getServerHost } from '@shipyard/config';
import { SettingsService } from './settings-service';
import { classifyHostRecords, type HostDnsState } from './domain-names';

export { classifyHostRecords, type HostDnsState };

const BASE_DOMAIN = config.baseDomain;

/** Read on every call so a token saved in Settings applies without a restart. */
function credentials() {
  return {
    token: SettingsService.get('cloudflare_api_token'),
    zoneId: SettingsService.get('cloudflare_zone_id'),
  };
}

interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

/**
 * Helper to make Cloudflare API requests with proper auth and error handling.
 */
async function cfFetch<T = any>(
  path: string,
  options: RequestInit = {},
  zoneOverride?: string | null,
): Promise<{ success: boolean; result: T; errors?: any[] }> {
  const { zoneId } = credentials();
  const zone = zoneOverride || zoneId;
  if (!zone) {
    throw new Error('Cloudflare is not connected. Add the API token and zone ID in Settings.');
  }
  if (!/^[a-f0-9]{32}$/i.test(zone)) throw new Error('Invalid Cloudflare zone ID');
  return cfRequest<T>(`/zones/${zone}${path}`, options);
}

/** Any Cloudflare API path (account-level calls such as listing zones). */
async function cfRequest<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<{ success: boolean; result: T; errors?: any[] }> {
  const { token } = credentials();
  if (!token) {
    throw new Error('Cloudflare is not connected. Add the API token and zone ID in Settings.');
  }

  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = (await res.json()) as { success: boolean; result: T; errors?: any[] };

  if (!res.ok || !data.success) {
    const errMsg = data.errors?.map((e: any) => e.message).join(', ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API error: ${errMsg}`);
  }

  return data;
}

export interface CloudflareZone {
  id: string;
  name: string;
}

export const CloudflareService = {
  /** Whether DNS records can be managed automatically. */
  isConfigured(): boolean {
    const { token, zoneId } = credentials();
    return Boolean(token && zoneId);
  },

  /**
   * Checks if a subdomain is available.
   * Returns true if available (no DNS record found), false otherwise.
   */
  async checkSubdomain(subdomain: string): Promise<boolean> {
    if (!subdomain) return false;

    // 1. Basic Validation
    const s = subdomain.toLowerCase().trim();
    if (!/^[a-z0-9-]+$/.test(s)) {
      throw new Error('Invalid subdomain format. Use letters, numbers, and hyphens.');
    }
    if (s.startsWith('-') || s.endsWith('-')) {
      throw new Error('Subdomain cannot start or end with a hyphen.');
    }

    // Checking against local reserved words (optional, but good practice)
    const RESERVED = ['www', 'api', 'admin', 'mail', 'ftp', 'localhost'];
    if (RESERVED.includes(s)) return false;

    if (!this.isConfigured()) {
      console.warn(
        'Cloudflare credentials missing. Skipping actual API check (Assuming available).',
      );
      return true;
    }

    try {
      // 2. Query Cloudflare DNS Records
      const queryName = `${s}.${BASE_DOMAIN}`;
      const data = await cfFetch<any[]>(`/dns_records?name=${queryName}`);
      // If result array is empty, no record exists -> Available
      return data.result.length === 0;
    } catch (error) {
      console.error('Cloudflare Service Error:', error);
      throw error;
    }
  },

  /**
   * Creates an A record for a subdomain pointing to the server IP.
   * Initially created as DNS-only (grey cloud, proxied=false) so Let's Encrypt
   * HTTP-01 validation can reach the server directly.
   *
   * @returns The Cloudflare DNS record ID for later management.
   */
  async createARecord(
    subdomain: string,
    serverIp?: string,
  ): Promise<{ recordId: string; fullDomain: string }> {
    serverIp ??= await getServerHost();
    const s = subdomain.toLowerCase().trim();
    const fullDomain = `${s}.${BASE_DOMAIN}`;

    console.log(`[CloudflareService] Creating A record: ${fullDomain} -> ${serverIp} (DNS-only)`);

    const data = await cfFetch<CloudflareDnsRecord>('/dns_records', {
      method: 'POST',
      body: JSON.stringify({
        type: 'A',
        name: fullDomain,
        content: serverIp,
        ttl: 1, // Auto TTL
        proxied: false, // Grey cloud — DNS-only for Let's Encrypt validation
        comment: 'Created by ShipYard platform',
      }),
    });

    console.log(`[CloudflareService] A record created: ${fullDomain} (ID: ${data.result.id})`);
    return { recordId: data.result.id, fullDomain };
  },

  /**
   * Deletes a DNS record by its Cloudflare record ID.
   */
  async deleteARecord(dnsRecordId: string, zoneId?: string | null): Promise<void> {
    console.log(`[CloudflareService] Deleting DNS record: ${dnsRecordId}`);

    await cfFetch(
      `/dns_records/${dnsRecordId}`,
      {
        method: 'DELETE',
      },
      zoneId,
    );

    console.log(`[CloudflareService] DNS record deleted: ${dnsRecordId}`);
  },

  /**
   * Gets an existing A record for a subdomain (if it exists).
   * @returns The record if found, null otherwise.
   */
  async getARecord(subdomain: string): Promise<CloudflareDnsRecord | null> {
    const s = subdomain.toLowerCase().trim();
    const queryName = `${s}.${BASE_DOMAIN}`;

    const data = await cfFetch<CloudflareDnsRecord[]>(`/dns_records?type=A&name=${queryName}`);

    if (data.result.length === 0) return null;
    return data.result[0];
  },

  /**
   * Updates a DNS record's proxy mode.
   * Call this AFTER SSL is issued to enable Cloudflare CDN + DDoS protection (orange cloud).
   */
  async updateProxyMode(
    dnsRecordId: string,
    proxied: boolean,
    zoneId?: string | null,
  ): Promise<void> {
    const mode = proxied ? 'proxied (orange cloud)' : 'DNS-only (grey cloud)';
    console.log(`[CloudflareService] Updating record ${dnsRecordId} to ${mode}`);

    await cfFetch(
      `/dns_records/${dnsRecordId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ proxied }),
      },
      zoneId,
    );

    console.log(`[CloudflareService] Record ${dnsRecordId} updated to ${mode}`);
  },

  /**
   * The Cloudflare zone a hostname belongs to, among the zones this API token can
   * manage (the account's zones). Throws when none matches.
   */
  async zoneFor(hostname: string): Promise<CloudflareZone> {
    const host = hostname.toLowerCase();
    const labels = host.split('.');
    // Longest match first: shop.example.co.uk -> example.co.uk before co.uk.
    for (let i = 0; i <= labels.length - 2; i++) {
      const candidate = labels.slice(i).join('.');
      const data = await cfRequest<CloudflareZone[]>(
        `/zones?name=${encodeURIComponent(candidate)}&status=active`,
      ).catch(() => null);
      const zone = data?.result?.[0];
      if (zone?.id) return { id: zone.id, name: zone.name };
    }
    // Tokens scoped to a single zone may not list zones: try the configured one.
    const { zoneId } = credentials();
    if (zoneId) {
      const configured = await cfRequest<CloudflareZone>(`/zones/${zoneId}`).catch(() => null);
      const name = configured?.result?.name?.toLowerCase();
      if (name && (host === name || host.endsWith(`.${name}`))) {
        return { id: zoneId, name };
      }
    }
    throw new Error(
      `${hostname} is not in a Cloudflare zone this API token can manage. Add the domain to the same Cloudflare account (and to the token's zones).`,
    );
  },

  async listHostRecords(zoneId: string, hostname: string) {
    const data = await cfFetch<CloudflareDnsRecord[]>(
      `/dns_records?name=${encodeURIComponent(hostname.toLowerCase())}&per_page=100`,
      {},
      zoneId,
    );
    return data.result;
  },

  /** How a hostname resolves today, without changing anything. */
  async inspectHost(hostname: string, serverIp: string, cnameTarget?: string) {
    const zone = await this.zoneFor(hostname);
    const records = await this.listHostRecords(zone.id, hostname);
    return { zone, dns: classifyHostRecords(records, serverIp, cnameTarget) };
  },

  /**
   * Makes a hostname point at this server. Existing records that already do are reused
   * untouched (owned: false); a missing one is created DNS-only so the certificate can
   * be issued (owned: true). Anything pointing elsewhere is left alone and reported.
   */
  async ensureHost(
    hostname: string,
    serverIp: string,
    cnameTarget?: string,
  ): Promise<{ zoneId: string; recordId: string; owned: boolean; proxied: boolean }> {
    const { zone, dns } = await this.inspectHost(hostname, serverIp, cnameTarget);
    if (dns.state === 'ours') {
      return { zoneId: zone.id, recordId: dns.recordId, owned: false, proxied: dns.proxied };
    }
    if (dns.state === 'elsewhere') {
      throw new Error(
        `${hostname} already points somewhere else (${dns.detail}). Remove or change that DNS record in Cloudflare first.`,
      );
    }
    console.log(`[CloudflareService] Creating A record: ${hostname} -> ${serverIp} (DNS-only)`);
    const data = await cfFetch<CloudflareDnsRecord>(
      '/dns_records',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'A',
          name: hostname.toLowerCase(),
          content: serverIp,
          ttl: 1,
          proxied: false,
          comment: 'Created by ShipYard platform',
        }),
      },
      zone.id,
    );
    return { zoneId: zone.id, recordId: data.result.id, owned: true, proxied: false };
  },
};
