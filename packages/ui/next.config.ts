import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

/**
 * The dashboard is a fully client-side app, so production builds are a static export
 * (`out/`) that Nginx serves directly: no Node process for the UI. Nginx also sends /api
 * to the Control API; in development (`next dev`) the rewrite below does that instead.
 */
export default function config(phase: string): NextConfig {
  const base: NextConfig = {
    typescript: { ignoreBuildErrors: true },
    images: { unoptimized: true },
  };

  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const controlApi = (process.env.CONTROL_API_URL || 'http://127.0.0.1:4010').replace(/\/+$/, '');
    return {
      ...base,
      async rewrites() {
        return [{ source: '/api/:path*', destination: `${controlApi}/api/:path*` }];
      },
    };
  }

  return { ...base, output: 'export' };
}
