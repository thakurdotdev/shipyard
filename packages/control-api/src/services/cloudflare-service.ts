const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'thakur.dev';
const SERVER_HOST = process.env.SERVER_HOST || '127.0.0.1';

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
): Promise<{ success: boolean; result: T; errors?: any[] }> {
  if (!CF_API_TOKEN || !CF_ZONE_ID) {
    throw new Error('Cloudflare credentials missing (CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID)');
  }

  const url = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
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

export const CloudflareService = {
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

    if (!CF_API_TOKEN || !CF_ZONE_ID) {
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
    serverIp: string = SERVER_HOST,
  ): Promise<{ recordId: string; fullDomain: string }> {
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
  async deleteARecord(dnsRecordId: string): Promise<void> {
    console.log(`[CloudflareService] Deleting DNS record: ${dnsRecordId}`);

    await cfFetch(`/dns_records/${dnsRecordId}`, {
      method: 'DELETE',
    });

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
  async updateProxyMode(dnsRecordId: string, proxied: boolean): Promise<void> {
    const mode = proxied ? 'proxied (orange cloud)' : 'DNS-only (grey cloud)';
    console.log(`[CloudflareService] Updating record ${dnsRecordId} to ${mode}`);

    await cfFetch(`/dns_records/${dnsRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ proxied }),
    });

    console.log(`[CloudflareService] Record ${dnsRecordId} updated to ${mode}`);
  },
};
