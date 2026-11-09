import { GATE_PATH_PREFIX } from './gate-session';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LoginPageOptions {
  projectName: string;
  next: string;
  error?: string | null;
}

/**
 * The page visitors see before reaching a protected site. Self-contained (inline
 * CSS, no scripts, no external requests) because it is served from the project's
 * own domain, under a strict CSP.
 */
export function renderLoginPage({ projectName, next, error }: LoginPageOptions): string {
  const name = escapeHtml(projectName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${name} · Password required</title>
<style>
:root{color-scheme:light dark;--bg:#fafafa;--card:#fff;--fg:#0a0a0a;--muted:#52525b;--border:rgba(10,10,10,.1);--brand:#65a30d;--brand-fg:#0a0a0b;--danger:#dc2626;--ring:rgba(101,163,13,.35)}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0b;--card:#111113;--fg:#fafafa;--muted:#a1a1aa;--border:rgba(255,255,255,.1);--brand:#84cc16;--danger:#f87171;--ring:rgba(132,204,22,.35)}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:380px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.05)}
.lock{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--brand) 16%,transparent);color:var(--brand);margin-bottom:18px}
h1{margin:0;font-size:20px;line-height:1.3;letter-spacing:-.01em;font-weight:600;overflow-wrap:anywhere}
p.sub{margin:6px 0 22px;color:var(--muted);font-size:14px}
label{display:block;font-size:13px;font-weight:500;margin-bottom:6px}
input[type=password]{width:100%;height:42px;padding:0 12px;border-radius:9px;border:1px solid var(--border);background:transparent;color:inherit;font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
input[type=password]:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--ring)}
input[aria-invalid=true]{border-color:var(--danger)}
button{margin-top:14px;width:100%;height:42px;border:0;border-radius:9px;background:var(--brand);color:var(--brand-fg);font:inherit;font-weight:600;cursor:pointer;transition:filter .15s}
button:hover{filter:brightness(1.06)}
button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.error{display:flex;gap:8px;align-items:flex-start;margin:0 0 14px;padding:10px 12px;border-radius:9px;font-size:13px;color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,transparent);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent)}
footer{margin-top:18px;text-align:center;font-size:12px;color:var(--muted)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<main>
  <form class="card" method="post" action="${GATE_PATH_PREFIX}/login">
    <div class="lock" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    </div>
    <h1>${name}</h1>
    <p class="sub">This site is private. Enter the password to continue.</p>
    ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required autofocus maxlength="128" autocomplete="current-password"${error ? ' aria-invalid="true"' : ''}>
    <button type="submit">Continue</button>
  </form>
  <footer>Protected by ShipYard</footer>
</main>
</body>
</html>`;
}
