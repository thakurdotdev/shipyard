import { describe, expect, test } from 'bun:test';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.SECRET ||= 'test-secret-for-internal-routes';

const { Elysia } = await import('elysia');
const { internalBuildRoutes } = await import('./builds');

// Mounted like index.ts mounts it among the public routes.
const app = new Elysia().use(internalBuildRoutes).get('/other', () => 'ok');

describe('build callbacks from the Deploy Engine', () => {
  // Reachable through the public /api prefix, and a `success` status activates the build.
  test('reject callers without the internal token', async () => {
    const status = await app.handle(
      new Request('http://localhost/builds/some-build', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'success' }),
      }),
    );
    expect(status.status).toBe(403);

    const logs = await app.handle(
      new Request('http://localhost/builds/some-build/logs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shipyard-internal': 'guess' },
        body: JSON.stringify({ logs: '<script>', level: 'info' }),
      }),
    );
    expect(logs.status).toBe(403);
  });

  test('the guard stays scoped to these routes', async () => {
    const other = await app.handle(new Request('http://localhost/other'));
    expect(other.status).toBe(200);
  });
});
