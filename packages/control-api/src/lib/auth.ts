import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db';
import { account, session, user, verification } from '../db/schema';

const authOrigin = process.env.BETTER_AUTH_URL
  ? new URL(process.env.BETTER_AUTH_URL).origin
  : undefined;

export const auth = betterAuth({
  appName: 'ShipYard',
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
    // Other *.thakur.dev apps (e.g. SyncVibe) also use better-auth and set
    // `__Secure-better-auth.session_token` on `.thakur.dev`. The browser sends that
    // cookie here too, ahead of ours, and the session lookup fails. A unique
    // prefix keeps the two cookies apart. The UI and API share one origin, so
    // the cookie also doesn't need to be shared across subdomains.
    cookiePrefix: 'shipyard',
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip'],
    },
  },
});
