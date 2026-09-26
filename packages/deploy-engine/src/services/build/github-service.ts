import jwt from 'jsonwebtoken';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

interface GitHubInstallationToken {
  token: string;
  expires_at: string;
}

/**
 * Resolves the path to the GitHub App private key file.
 * Priority: GITHUB_APP_PRIVATE_KEY_PATH env var > repo root > home dir.
 */
function getPrivateKeyPath(): string {
  if (process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
    return resolve(process.env.GITHUB_APP_PRIVATE_KEY_PATH);
  }

  // __dirname is packages/deploy-engine/src/services/build, so the repo root is 5 levels up.
  const candidates = [
    join(__dirname, '..', '..', '..', '..', '..', 'github-app.pem'),
    join(process.env.HOME || '/root', 'github-app.pem'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return candidates[0];
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

export const WorkerGitHubService = {
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
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 10 * 60,
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
   * Retrieves an installation access token for a specific installation.
   * @throws Error if JWT generation fails or GitHub API returns an error
   */
  async getInstallationToken(installationId: string): Promise<string> {
    if (!installationId) {
      throw new Error('Installation ID is required');
    }

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
      const errorBody = await res.text();
      let errorMessage = `GitHub API error (${res.status}): ${res.statusText}`;

      try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.message) {
          errorMessage = `GitHub API error: ${errorJson.message}`;
        }
      } catch {
        // Use raw error body if not JSON
        if (errorBody) {
          errorMessage = `GitHub API error: ${errorBody}`;
        }
      }

      throw new Error(errorMessage);
    }

    const data = (await res.json()) as GitHubInstallationToken;
    return data.token;
  },
};
