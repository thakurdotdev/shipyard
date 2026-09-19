import { createAuthClient } from 'better-auth/react';

const apiEndpoint = process.env.NEXT_PUBLIC_API_URL;
const baseURL = apiEndpoint ? new URL(apiEndpoint).origin : undefined;

export const authClient = createAuthClient({
  baseURL,
  basePath: '/api/auth',
});
