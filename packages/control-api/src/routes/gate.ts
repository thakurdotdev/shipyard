import { Elysia } from 'elysia';
import { GateService } from '../services/gate-service';
import { renderLoginPage } from '../services/gate-page';
import {
  GATE_COOKIE,
  GATE_PATH_PREFIX,
  LoginThrottle,
  MAX_PASSWORD_LENGTH,
  clearedSessionCookie,
  normalizeHost,
  readCookie,
  sanitizeNext,
  sessionCookie,
  signSession,
  verifyMonitorToken,
  verifySession,
} from '../services/gate-session';

/**
 * Endpoints behind the password gate on protected project domains.
 *
 * Nginx calls `/gate/verify` (via `auth_request`) before serving every request to a
 * protected site, and proxies `/__shipyard_gate/*` on that site's own domain to the
 * login routes here. Both are only meaningful with the `X-Gate-Host` header nginx sets.
 */

const throttle = new LoginThrottle();

const pageHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function status(code: number, headers: Record<string, string> = {}) {
  return new Response(null, { status: code, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** Where to send the visitor after login: the URL they originally asked for. */
function destinationFrom(originalUri: string | null): string {
  if (!originalUri) return '/';
  if (originalUri.startsWith(GATE_PATH_PREFIX)) {
    const query = originalUri.split('?')[1];
    return sanitizeNext(query ? new URLSearchParams(query).get('next') : null);
  }
  return sanitizeNext(originalUri);
}

function clientKey(projectId: string, request: Request): string {
  const ip = request.headers.get('x-real-ip') || 'unknown';
  return `${projectId}:${ip}`;
}

export const gateRoutes = new Elysia({ prefix: '/gate' })
  .get('/verify', async ({ request }) => {
    const host = normalizeHost(request.headers.get('x-gate-host'));
    if (!host) return status(403);

    const record = await GateService.findByHost(host);
    // Nginx only enables the gate for domains that belong to a project; fail closed otherwise.
    if (!record) return status(403);
    if (!record.enabled) return status(200);
    if (!record.passwordHash) return status(403);

    if (
      verifyMonitorToken(
        request.headers.get('x-shipyard-gate-monitor'),
        record.projectId,
        record.passwordHash,
      )
    ) {
      return status(200);
    }
    const token = readCookie(request.headers.get('cookie'), GATE_COOKIE);
    if (verifySession(token, record.projectId, record.passwordHash)) return status(200);
    return status(401);
  })
  .get('/login', async ({ request }) => {
    const host = normalizeHost(request.headers.get('x-gate-host'));
    const record = host ? await GateService.findByHost(host) : null;
    if (!record) return status(404);

    const next = destinationFrom(request.headers.get('x-original-uri'));
    if (!record.enabled) return status(302, { Location: next });

    return new Response(renderLoginPage({ projectName: record.projectName, next }), {
      status: 401,
      headers: pageHeaders,
    });
  })
  .post('/login', async ({ request }) => {
    const host = normalizeHost(request.headers.get('x-gate-host'));
    const record = host ? await GateService.findByHost(host) : null;
    if (!record) return status(404);

    const form = new URLSearchParams(await request.text());
    const next = sanitizeNext(form.get('next'));
    if (!record.enabled) return status(303, { Location: next });
    if (!record.passwordHash) return status(403);

    // Browsers always send Origin on cross-site form posts; refuse ones from another site.
    const origin = request.headers.get('origin');
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = normalizeHost(new URL(origin).host);
      } catch {
        // Treated as a mismatch below.
      }
      if (originHost !== host) return status(403);
    }

    const render = (error: string, code: number, headers: Record<string, string> = {}) =>
      new Response(renderLoginPage({ projectName: record.projectName, next, error }), {
        status: code,
        headers: { ...pageHeaders, ...headers },
      });

    const key = clientKey(record.projectId, request);
    const wait = throttle.retryAfter(key);
    if (wait > 0) {
      return render(
        `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 90 ? 's' : ''}.`,
        429,
        { 'Retry-After': String(wait) },
      );
    }

    const password = form.get('password') ?? '';
    const ok =
      password.length > 0 &&
      password.length <= MAX_PASSWORD_LENGTH &&
      (await Bun.password.verify(password, record.passwordHash));
    if (!ok) {
      throttle.recordFailure(key);
      return render('Incorrect password. Please try again.', 401);
    }

    throttle.reset(key);
    const token = signSession(record.projectId, record.passwordHash, record.sessionHours);
    return status(303, {
      Location: next,
      'Set-Cookie': sessionCookie(token, Math.round(record.sessionHours * 3600)),
    });
  })
  .get('/logout', () => status(303, { Location: '/', 'Set-Cookie': clearedSessionCookie() }));
