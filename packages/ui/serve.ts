/**
 * Serves the static dashboard (`out/`) for setups whose Nginx still proxies to the UI
 * port instead of serving the files itself. Same rules as the installer's Nginx config:
 * /api goes to the Control API, /projects/<id> uses the shared project page, and every
 * other path maps to its exported .html file.
 *
 *   bun run build && bun serve.ts      (PORT defaults to 4013)
 */
import { existsSync, statSync } from 'fs';
import { join, normalize } from 'path';

const ROOT = join(import.meta.dir, 'out');
const PORT = Number(process.env.PORT) || 4013;
const CONTROL_API = (process.env.CONTROL_API_URL || 'http://127.0.0.1:4010').replace(/\/+$/, '');

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The exported file for a URL path, or null. Exported for tests. */
export function resolveStatic(pathname: string, root = ROOT): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const clean = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  if (clean.includes('\0') || clean.split('/').includes('..')) return null;
  const file = (p: string) => (isFile(join(root, p)) ? join(root, p) : null);

  const project = clean.match(/^\/projects\/([^/]+?)(\.txt)?$/);
  if (project) {
    const [, id, txt] = project;
    return (
      file(clean) ??
      (txt ? file('/projects/_.txt') : (file(`/projects/${id}.html`) ?? file('/projects/_.html')))
    );
  }
  const projectAsset = clean.match(/^\/projects\/[^/]+\/([^/]+)$/);
  if (projectAsset) return file(clean) ?? file(`/projects/_/${projectAsset[1]}`);

  if (clean === '/' || clean === '') return file('/index.html');
  return file(clean) ?? file(`${clean}.html`) ?? file(join(clean, 'index.html'));
}

function cacheControl(path: string): string {
  return path.includes(`${join('out', '_next', 'static')}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

if (import.meta.main) {
  if (!existsSync(join(ROOT, 'index.html'))) {
    console.error(`[ui] ${ROOT} is missing. Run \`bun run build\` first.`);
    process.exit(1);
  }

  Bun.serve({
    port: PORT,
    idleTimeout: 0, // log streams (SSE) stay open
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const headers = new Headers(request.headers);
        headers.set('x-forwarded-host', url.host);
        return fetch(`${CONTROL_API}${url.pathname}${url.search}`, {
          method: request.method,
          headers,
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
          redirect: 'manual',
        });
      }
      const path = resolveStatic(url.pathname);
      if (!path) {
        const notFound = join(ROOT, '404.html');
        return new Response(Bun.file(notFound), {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(Bun.file(path), { headers: { 'Cache-Control': cacheControl(path) } });
    },
  });
  console.log(`[ui] Serving ${ROOT} on :${PORT} (API: ${CONTROL_API})`);
}
