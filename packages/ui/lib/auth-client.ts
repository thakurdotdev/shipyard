import { createAuthClient } from 'better-auth/react';

// Same origin as the dashboard unless NEXT_PUBLIC_API_URL points the API elsewhere.
const apiEndpoint = process.env.NEXT_PUBLIC_API_URL;
const baseURL =
  apiEndpoint && /^https?:\/\//.test(apiEndpoint) ? new URL(apiEndpoint).origin : undefined;

export const authClient = createAuthClient({
  baseURL,
  basePath: '/api/auth',
});
