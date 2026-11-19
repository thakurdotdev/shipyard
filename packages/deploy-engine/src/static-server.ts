import { stat } from 'fs/promises';
import { extname, join, resolve, sep } from 'path';
import { ASSET_EXTENSIONS, getStaticDirectory, pageCandidates } from './services/static-site';

const [dir, portStr, kindArg = 'spa'] = process.argv.slice(2);

if (!dir || !portStr || (kindArg !== 'spa' && kindArg !== 'pages')) {
  console.error('Usage: bun static-server.ts <directory> <port> [spa|pages]');
  process.exit(1);
}

const port = parseInt(portStr, 10);
const kind = kindArg as 'spa' | 'pages';
const baseDir = getStaticDirectory(dir, '.');
const assetPattern = new RegExp(`\\.(?:${ASSET_EXTENSIONS})$`, 'i');

console.log(`Starting static server (${kind}) for ${baseDir} on port ${port}`);

/** A regular file inside the site, or null. Never follows a path out of baseDir. */
async function fileAt(pathname: string): Promise<string | null> {
  if (pathname.includes('\0')) return null;
  const fullPath = resolve(baseDir, `.${pathname}`);
  if (fullPath !== baseDir && !fullPath.startsWith(baseDir + sep)) return null;
  try {
    return (await stat(fullPath)).isFile() ? fullPath : null;
  } catch {
    return null;
  }
}

function respond(req: Request, path: string, status = 200): Response {
  const file = Bun.file(path);
  const html = path.endsWith('.html');
  return new Response(req.method === 'HEAD' ? null : file, {
    status,
    headers: {
      'Content-Type': html ? 'text/html; charset=utf-8' : file.type,
      ...(html ? { 'Cache-Control': 'no-cache' } : {}),
      ...(path.includes(`${sep}_next${sep}static${sep}`)
        ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
        : {}),
    },
  });
}

Bun.serve({
  port,
  // ShipYard sets HOST to loopback; Nginx is the only way in.
  hostname: process.env.HOST || '127.0.0.1',
  async fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url).pathname);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const isAsset = pathname.startsWith('/assets/') || assetPattern.test(extname(pathname));

    if (kind === 'pages') {
      for (const candidate of isAsset ? [pathname] : pageCandidates(pathname)) {
        const found = await fileAt(candidate);
        if (found) return respond(req, found);
      }
      const notFound = await fileAt('/404.html');
      if (notFound && !isAsset) return respond(req, notFound, 404);
      return new Response('Not Found', { status: 404 });
    }

    // spa
    const found = await fileAt(pathname === '/' ? '/index.html' : pathname);
    if (found) return respond(req, found);
    if (!isAsset) {
      const index = await fileAt('/index.html');
      if (index) return respond(req, index);
    }
    return new Response('Not Found', { status: 404 });
  },
});
