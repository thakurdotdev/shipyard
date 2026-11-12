import type { NextConfig } from 'next';

// In production Nginx sends /api to the Control API before requests reach Next.js.
// This rewrite does the same for local development (`bun run dev`).
const controlApi = (process.env.CONTROL_API_URL || 'http://127.0.0.1:4010').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${controlApi}/api/:path*` }];
  },
};

export default nextConfig;
