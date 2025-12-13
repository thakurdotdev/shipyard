import jwt from 'jsonwebtoken';
import { createHmac } from 'crypto';

interface GitHubInstallationToken {
  token: string;
  expires_at: string;
}

export const GitHubService = {
  /**
   * Generates a JWT for authenticating as the GitHub App.
   */
  generateAppJWT(): string {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      throw new Error('Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY');
    }

    // Decoding base64 private key if needed, or handling raw PEM
    // Usually env vars handle newlines poorly, so base64 is common.
    // Let's assume standard PEM format or base64 encoded PEM.
    let key = privateKey;
    if (!key.includes('-----BEGIN RSA PRIVATE KEY-----')) {
      try {
        key = Buffer.from(privateKey, 'base64').toString('utf-8');
      } catch (e) {
        // keep as is
      }
    }

    const payload = {
      iat: Math.floor(Date.now() / 1000) - 60, // Issued at time, 60 seconds in the past
      exp: Math.floor(Date.now() / 1000) + 10 * 60, // Expires in 10 minutes
      iss: appId,
    };

    return jwt.sign(payload, key, { algorithm: 'RS256' });
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
