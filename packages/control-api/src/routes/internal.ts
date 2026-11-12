import { config } from '@thakur-deploy/config';
import { timingSafeEqual } from 'crypto';
import { Elysia, t } from 'elysia';
import { GitHubService } from '../services/github-service';

export const INTERNAL_TOKEN_HEADER = 'x-shipyard-internal';

/** True when the request carries the token only the platform's own services can derive. */
export function hasInternalToken(request: Request): boolean {
  const expected = config.internalToken;
  const given = request.headers.get(INTERNAL_TOKEN_HEADER);
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Calls from the Deploy Engine. The GitHub App key lives in the database, which only the
 * Control API reads, so the engine asks here for short-lived clone tokens.
 */
export const internalRoutes = new Elysia({ prefix: '/internal' })
  .onBeforeHandle(({ request, set }) => {
    if (!hasInternalToken(request)) {
      set.status = 403;
      return { error: 'Forbidden' };
    }
  })
  .post(
    '/github/installation-token',
    async ({ body, set }) => {
      try {
        return { token: await GitHubService.getInstallationToken(body.installation_id) };
      } catch (error) {
        set.status = 502;
        return { error: error instanceof Error ? error.message : 'Could not get a GitHub token' };
      }
    },
    { body: t.Object({ installation_id: t.String({ pattern: '^[0-9]+$' }) }) },
  );
