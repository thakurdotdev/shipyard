/**
 * Where the browser reaches the Control API. The dashboard and API share one origin
 * (Nginx sends /api to the Control API; in development next.config.ts rewrites it), so
 * the default is the relative `/api` and nothing has to be baked in at build time.
 * NEXT_PUBLIC_API_URL still overrides it for setups that serve the API elsewhere.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || '/api').replace(/\/+$/, '');
