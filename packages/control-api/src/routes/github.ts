import { Elysia, t } from 'elysia';
import { auth } from '../lib/auth';
import { db } from '../db';
import { account } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { GitHubService } from '../services/github-service';

export const githubRoutes = new Elysia({ prefix: '/github' })
  .derive(async ({ request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    return { user: session?.user, session: session?.session };
  })
  .onBeforeHandle(({ user, set }) => {
    if (!user) {
      set.status = 401;
      return 'Unauthorized';
    }
  })
  .get('/installations', async ({ user, set }) => {
    try {
      // 1. Get User's GitHub Access Token
      const userAccount = await db
        .select()
        .from(account)
        .where(and(eq(account.userId, user!.id), eq(account.providerId, 'github')))
        .limit(1);

      if (!userAccount.length || !userAccount[0].accessToken) {
        console.error('[GitHub] No linked account for user:', user!.id);
        set.status = 400;
        return { error: 'No linked GitHub account found' };
      }

      const token = userAccount[0].accessToken;

      // 2. List user's installations of OUR App
      const res = await fetch('https://api.github.com/user/installations', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('[GitHub] API Error /user/installations:', res.status, errText);
        set.status = 502;
        return { error: `GitHub API Error: ${res.statusText}` };
      }

      const data = await res.json();
      return data;
    } catch (e: any) {
      console.error('[GitHub] Internal Error:', e);
      set.status = 500;
      return { error: e.message || 'Internal Server Error' };
    }
  })
  .get('/installations/:id/repositories', async ({ params, user, set }) => {
    try {
      const installationId = params.id;

      const token = await GitHubService.getInstallationToken(installationId);

      const res = await fetch('https://api.github.com/installation/repositories', {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[GitHub] API Error /installation/repositories:', err);
        set.status = 502;
        return { error: `GitHub API Error: ${res.statusText}` };
      }

      const data = await res.json();
      return data;
    } catch (e: any) {
      console.error('[GitHub] Internal Error (Repos):', e);
      set.status = 500;
      return { error: e.message || 'Internal Server Error' };
    }
  });
