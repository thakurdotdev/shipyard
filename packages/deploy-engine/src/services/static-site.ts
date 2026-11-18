import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * How a static site maps URLs to files.
 *  - `spa`:   one HTML shell (Vite). Unknown routes get index.html; the client router decides.
 *  - `pages`: one HTML file per route (Next.js `output: "export"`). /about is about.html or
 *             about/index.html; unknown routes get 404.html with a real 404 status.
 */
export type StaticSiteKind = 'spa' | 'pages';

export interface StaticSite {
  directory: string;
  kind: StaticSiteKind;
}

/** File extensions that are never routes: a missing one is a 404, never an HTML page. */
export const ASSET_EXTENSIONS =
  'js|mjs|css|map|json|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|wasm|txt|xml|webmanifest';

/** Never activate a successful build command that did not produce a static site. */
export function getStaticDirectory(cwd: string, outputDirectory = 'dist'): string {
  const directory = resolve(cwd, outputDirectory);
  try {
    if (statSync(join(directory, 'index.html')).isFile()) return directory;
  } catch {
    // Report the expected output, rather than starting a server that only returns 404.
  }
  throw new Error(
    `Static build output missing: ${join(directory, 'index.html')}. Ensure the build command produces ${outputDirectory}/index.html.`,
  );
}

/**
 * True when `next build` ran with `output: "export"`: it writes `out/` holding the
 * pages and the `_next/` assets. A server build never creates `out/`.
 */
export function isNextStaticExport(appDir: string): boolean {
  const out = join(appDir, 'out');
  try {
    return statSync(join(out, 'index.html')).isFile() && existsSync(join(out, '_next'));
  } catch {
    return false;
  }
}

/**
 * The static site a build produced, or null when the app needs a server process.
 * Vite always builds a static site (and must have dist/index.html); Next.js only
 * when exported.
 */
export function resolveStaticSite(appType: string, appDir: string): StaticSite | null {
  if (appType === 'vite') return { directory: getStaticDirectory(appDir), kind: 'spa' };
  if (appType === 'nextjs' && isNextStaticExport(appDir)) {
    return { directory: getStaticDirectory(appDir, 'out'), kind: 'pages' };
  }
  return null;
}

/**
 * Nginx locations serving a static site from `root`. Shared by host Nginx and the Vite
 * container. HTML must be revalidated on every deploy.
 */
export function staticSiteLocations(kind: StaticSiteKind = 'spa'): string {
  return kind === 'pages' ? pageSiteLocations() : spaSiteLocations();
}

function spaSiteLocations(): string {
  return `
    index index.html;

    location = /index.html {
        add_header Cache-Control "no-cache" always;
    }

    # Missing bundles must return 404, never HTML with a JavaScript MIME type.
    location /assets/ {
        try_files $uri =404;
    }

    location ~* \\.(?:${ASSET_EXTENSIONS})$ {
        try_files $uri =404;
    }

    # Browser-history routes (including dotted route parameters) use the SPA shell.
    location / {
        try_files $uri $uri/ /index.html;
    }
`;
}

function pageSiteLocations(): string {
  return `
    index index.html;
    error_page 404 /404.html;

    # Content-hashed build output never changes.
    location ^~ /_next/static/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    location ~* \\.(?:${ASSET_EXTENSIONS})$ {
        try_files $uri =404;
    }

    # Every route is its own page: /about -> about.html or about/index.html.
    location / {
        add_header Cache-Control "no-cache" always;
        try_files $uri $uri.html $uri/index.html =404;
    }
`;
}

/** Candidate files for a request path on a `pages` site, in the order Nginx tries them. */
export function pageCandidates(pathname: string): string[] {
  if (pathname.endsWith('/')) return [`${pathname}index.html`];
  return [pathname, `${pathname}.html`, `${pathname}/index.html`];
}
