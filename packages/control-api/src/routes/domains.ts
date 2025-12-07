import { Elysia, t } from 'elysia';
import { CloudflareService } from '../services/cloudflare-service';
import { db } from '../db';
import { projects } from '../db/schema';
import { eq } from 'drizzle-orm';

export const domainsRoutes = new Elysia({ prefix: '/domains' }).get(
  '/check',
  async ({ query }) => {
    const { subdomain } = query;
    try {
      const BASE_DOMAIN = process.env.BASE_DOMAIN || 'thakur.dev';
      const fullDomain = `${subdomain}.${BASE_DOMAIN}`;

      // 1. Check DB first
      const existingProject = await db
        .select()
        .from(projects)
        .where(eq(projects.domain, fullDomain));

      if (existingProject.length > 0) {
        return { available: false };
      }

      // 2. Fallback to Cloudflare
      const isAvailable = await CloudflareService.checkSubdomain(subdomain);
      return { available: isAvailable };
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
  {
    query: t.Object({
      subdomain: t.String({ minLength: 1 }),
    }),
  },
);
