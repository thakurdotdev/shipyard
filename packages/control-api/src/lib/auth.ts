import { config } from '@thakur-deploy/config';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { count } from 'drizzle-orm';
import { db } from '../db';
import { account, session, user, verification } from '../db/schema';
import { githubAppConfig, SettingsService } from '../services/settings-service';

/**
 * Only the first person to sign in may create an account (they own this server); after
 * that, new accounts need "Allow new sign-ups" switched on in Settings. Anyone who can sign
 * in can deploy code to this machine, so an open sign-up would hand it to the internet.
 */
export async function canCreateAccount(): Promise<boolean> {
  if (SettingsService.flag('allow_signups')) return true;
  const [{ total }] = await db.select({ total: count() }).from(user);
  return total === 0;
}

/** BETTER_AUTH_URL still wins when set, so existing GitHub callback URLs keep matching. */
export function authBaseUrl(): string {
  const legacy = process.env.BETTER_AUTH_URL?.trim();
  if (legacy) {
    try {
      return new URL(legacy).origin;
    } catch {
      // fall through to the public URL
    }
  }
  return config.publicUrl;
}

function createAuth() {
  const github = githubAppConfig();
  return betterAuth({
    appName: 'ShipYard',
    baseURL: authBaseUrl(),
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.publicUrl],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user,
        session,
        account,
        verification,
      },
    }),
    // Without a connected GitHub App there is nothing to sign in with yet; /setup handles that.
    socialProviders:
      github.clientId && github.clientSecret
        ? { github: { clientId: github.clientId, clientSecret: github.clientSecret } }
        : {},
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!(await canCreateAccount())) {
              throw new APIError('FORBIDDEN', {
                message: 'signups_closed',
              });
            }
          },
        },
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
}

export type AuthInstance = ReturnType<typeof createAuth>;

let instance: AuthInstance | null = null;

/** The current auth instance; rebuilt after the GitHub App changes in Settings. */
export function getAuth(): AuthInstance {
  instance ??= createAuth();
  return instance;
}

SettingsService.onChange((changed) => {
  if (changed.some((key) => key.startsWith('github_'))) instance = null;
});

/** Same shape the routes always used (`auth.handler`, `auth.api.getSession`). */
export const auth: {
  handler: (request: Request) => Promise<Response>;
  readonly api: AuthInstance['api'];
} = {
  handler: (request: Request) => getAuth().handler(request),
  get api() {
    return getAuth().api;
  },
};
