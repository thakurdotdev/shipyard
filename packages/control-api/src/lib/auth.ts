import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db';
import { account, session, user, verification } from '../db/schema';

const authOrigin = process.env.BETTER_AUTH_URL
  ? new URL(process.env.BETTER_AUTH_URL).origin
  : undefined;

export const auth = betterAuth({
  appName: 'Thakur Deploy',
  baseURL: authOrigin!,
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET!,
  trustedOrigins: [process.env.CLIENT_URL!].filter(Boolean),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user,
      session,
      account,
      verification,
    },
  }),
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
    },
  },
});
