import jwt from 'jsonwebtoken';

interface GitHubInstallationToken {
  token: string;
  expires_at: string;
}

export const GitHubService = {
  generateAppJWT(): string {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      throw new Error('Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY');
    }

    let key = privateKey;
    if (!key.includes('-----BEGIN RSA PRIVATE KEY-----')) {
      try {
        key = Buffer.from(privateKey, 'base64').toString('utf-8');
      } catch (e) {
        // keep as is
      }
    }

    const payload = {
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 10 * 60,
      iss: appId,
    };

    return jwt.sign(payload, key, { algorithm: 'RS256' });
  },

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
};
