import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

interface GitHubInstallationToken {
  token: string;
  expires_at: string;
}

interface GitHubAppInfo {
  /** App id as configured on the server (from GITHUB_APP_ID). */
  id: string;
  /** Public slug, e.g. "thakur-deploy". */
  slug: string;
  /** Display name, e.g. "ShipYard". */
  name: string;
  /** Full install-page URL, e.g. https://github.com/apps/thakur-deploy/installations/new */
  installUrl: string;
}

/**
 * In-memory cache for GET /app metadata. The slug/name of an App change
 * roughly never, so a 1h TTL keeps the install page fast without any extra
 * config. Keyed by app id so a redeploy with different env can't serve a
 * stale answer from memory.
 */
let appInfoCache: { appId: string; fetchedAt: number; info: GitHubAppInfo } | null = null;
const APP_INFO_TTL_MS = 60 * 60 * 1000;

/**
 * Resolves the path to the GitHub App private key file.
 * Priority: GITHUB_APP_PRIVATE_KEY_PATH env var > default project root location
 */
function getPrivateKeyPath(): string {
  if (process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
    return resolve(process.env.GITHUB_APP_PRIVATE_KEY_PATH);
  }
  // Default: project root (4 levels up from services dir)
  return join(__dirname, '..', '..', '..', '..', 'github-app.pem');
}

/**
 * Reads and validates the GitHub App private key.
 * Throws descriptive errors for common issues.
 */
function loadPrivateKey(): string {
  const keyPath = getPrivateKeyPath();

  if (!existsSync(keyPath)) {
    throw new Error(
      `GitHub App private key not found at: ${keyPath}\n` +
        `Please ensure the PEM file exists or set GITHUB_APP_PRIVATE_KEY_PATH env variable.`,
    );
  }

  try {
    const key = readFileSync(keyPath, 'utf-8').trim();

    // Validate PEM format (supports both PKCS#1 and PKCS#8)
    if (!key.includes('-----BEGIN') || !key.includes('PRIVATE KEY-----')) {
      throw new Error(
        `Invalid PEM format in: ${keyPath}\n` + `Expected file to contain a valid RSA private key.`,
      );
    }

    return key;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid PEM')) {
      throw error;
    }
    throw new Error(
      `Failed to read GitHub App private key from: ${keyPath}\n` +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

export const GitHubService = {
  /**
   * Generates a JWT for authenticating as the GitHub App.
   * @throws Error if GITHUB_APP_ID is missing or private key is invalid
   */
  generateAppJWT(): string {
    const appId = process.env.GITHUB_APP_ID;

    if (!appId) {
      throw new Error(
        'Missing GITHUB_APP_ID environment variable.\n' + 'Please set this in your .env file.',
      );
    }

    const privateKey = loadPrivateKey();

    const payload = {
      iat: Math.floor(Date.now() / 1000) - 60, // Issued at time, 60 seconds in the past
      exp: Math.floor(Date.now() / 1000) + 10 * 60, // Expires in 10 minutes
      iss: appId,
    };

    try {
      return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
    } catch (error) {
      throw new Error(
        `Failed to sign JWT with GitHub App private key.\n` +
          `This usually means the private key format is incorrect.\n` +
          `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },

  /**
   * Resolves this server's GitHub App to its public install-page URL.
   *
   * Priority:
   *   1. GITHUB_INSTALL_URL — explicit override for dev/staging setups that
   *      register an App whose URL pattern differs (e.g. an Enterprise host).
   *   2. GITHUB_APP_SLUG — explicit slug, `https://github.com/apps/<slug>/…`.
   *   3. Auto-detected from GitHub: one GET /app call authenticating as the App
   *      (the same JWT + key already used for installation tokens), cached for
   *      an hour.
   *
   * This is exactly the value the UI needs for "Connect GitHub App" buttons,
   * so it never has to hard-code an App slug per environment.
   */
  async getAppInstallInfo(): Promise<GitHubAppInfo> {
    const appId = process.env.GITHUB_APP_ID;
    if (!appId) {
      throw new Error(
        'Missing GITHUB_APP_ID environment variable.\nPlease set this in your .env file.',
      );
    }

    const baseHost = 'github.com';
    const configuredUrl = process.env.GITHUB_INSTALL_URL?.trim();
    if (configuredUrl) {
      return { id: appId, slug: '', name: '', installUrl: configuredUrl };
    }

    const configuredSlug = process.env.GITHUB_APP_SLUG?.trim();
    if (configuredSlug) {
      return {
        id: appId,
        slug: configuredSlug,
        name: '',
        installUrl: `https://${baseHost}/apps/${configuredSlug}/installations/new`,
      };
    }

    if (
      appInfoCache &&
      appInfoCache.appId === appId &&
      Date.now() - appInfoCache.fetchedAt < APP_INFO_TTL_MS
    ) {
      return appInfoCache.info;
    }

    const res = await fetch('https://api.github.com/app', {
      headers: {
        Authorization: `Bearer ${this.generateAppJWT()}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'shipyard-control-api',
      },
    });

    if (!res.ok) {
      const err = (await res.text()).slice(0, 500);
      throw new Error(`Failed to resolve GitHub App info (HTTP ${res.status}): ${err}`);
    }

    const data = (await res.json()) as { id?: number; slug?: string; name?: string };

    if (!data.slug) {
      throw new Error(
        'GitHub GET /app returned no slug — check GITHUB_APP_ID and the PEM key match the intended App.',
      );
    }

    const info: GitHubAppInfo = {
      id: String(data.id ?? appId),
      slug: data.slug,
      name: data.name ?? '',
      installUrl: `https://${baseHost}/apps/${data.slug}/installations/new`,
    };
    appInfoCache = { appId, fetchedAt: Date.now(), info };
    return info;
  },

  /**
   * Verifies the GitHub webhook signature.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('Missing GITHUB_WEBHOOK_SECRET');
    }

    const expectedSignature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    return expectedSignature === signature;
  },

  /**
   * Retrieves an installation access token for a specific installation.
   */
  async getInstallationToken(installationId: string): Promise<string> {
    const appJwt = this.generateAppJWT();

    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('Failed to get installation token', err);
      throw new Error(`Failed to get installation token: ${res.statusText}`);
    }

    const data = (await res.json()) as GitHubInstallationToken;
    return data.token;
  },

  /**
   * Get metadata about a repository.
   * Useful for validating existence and getting default branch.
   */
  async getRepoMetadata(token: string, owner: string, repo: string) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) return null;
    return await res.json();
  },
};
