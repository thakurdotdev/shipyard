import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────── Theme ───────── */
const root = document.documentElement;
const themeBtn = $<HTMLButtonElement>('theme-toggle');
const syncThemeLabel = () => {
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  themeBtn?.setAttribute('aria-label', `Switch to ${next} theme`);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', next === 'dark' ? '#fafafa' : '#0a0a0b');
};
syncThemeLabel();
themeBtn?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem('shipyard-landing-theme', root.dataset.theme);
  } catch {}
  syncThemeLabel();
});

/* ───────── Nav: pill on scroll ───────── */
const nav = $('nav');
const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 12);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

/* ───────── Copy install command ───────── */
const copyBtn = $<HTMLButtonElement>('copy');
copyBtn?.addEventListener('click', async () => {
  const text = $('cmd-text')?.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('cmd-text')!);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    copyBtn.textContent = 'Selected';
  }
  setTimeout(() => (copyBtn.textContent = 'Copy'), 1800);
});

/* ───────── Uptime bars (one incident, then recovered) ───────── */
const bars = $('uptime-bars');
if (bars) {
  bars.innerHTML = Array.from(
    { length: 30 },
    (_, i) => `<i${i === 19 ? ' class="down"' : ''}></i>`,
  ).join('');
}

/* ───────── Footer year ───────── */
const year = $('year');
if (year) year.textContent = String(new Date().getFullYear());

/* ───────── Hero: replay of one deploy ─────────
   Mirrors the stages the Deploy Engine runs: clone, install, build,
   pre-deploy, then activation behind Nginx with a health check. */
type Step = 'clone' | 'install' | 'build' | 'predeploy' | 'activate';
type Line = { at: number; html: string; step?: Step; state?: 'building' | 'live' };

const d = (s: string) => `<span class="c-dim">${s}</span>`;
const tag = (s: string) => `<span class="c-brand">[${s}]</span>`;
const cmd = (s: string) => `<span class="c-cmd">${s}</span>`;
const ok = (s: string) => `<span class="c-ok">${s}</span>`;

const SCRIPT: Line[] = [
  { at: 0, html: `${d('$')} ${cmd('git push origin main')}` },
  { at: 500, html: `${d('→')} webhook received ${d('· acme-web @ 9f3c2a1 “Add pricing page”')}` },
  { at: 900, html: `${tag('queue')} position 1, starting build`, state: 'building' },
  { at: 1300, html: `${tag('clone')} github.com/acme/web ${d('#main')}`, step: 'clone' },
  { at: 1900, html: `${tag('install')} ${cmd('bun install')}`, step: 'install' },
  { at: 2900, html: `  ${ok('+')} 412 packages installed ${d('[2.31s]')}` },
  { at: 3300, html: `${tag('build')} ${cmd('bun run build')}`, step: 'build' },
  { at: 3700, html: `  ▲ Next.js 16` },
  { at: 4300, html: `  ${ok('✓')} Compiled successfully` },
  { at: 5000, html: `  ${ok('✓')} Generating static pages ${d('(24/24)')}` },
  { at: 5500, html: `  ${d('Route (app)                 Size')}` },
  { at: 5650, html: `  ${d('┌ ○ /                       5.1 kB')}` },
  { at: 5800, html: `  ${d('└ ○ /pricing                3.4 kB')}` },
  { at: 6300, html: `${tag('pre-deploy')} ${cmd('bun run db:migrate')}`, step: 'predeploy' },
  { at: 7100, html: `  ${ok('✓')} 2 migrations applied` },
  {
    at: 7600,
    html: `${tag('activate')} pm0 start acme-web ${d('→ 127.0.0.1:3012')}`,
    step: 'activate',
  },
  { at: 8100, html: `${tag('activate')} nginx: acme-web.example.com ${d('(TLS)')}` },
  { at: 8700, html: `${tag('health')} GET / ${ok('200 OK')}` },
  { at: 9200, html: `${ok('● Live')} ${d('at')} https://acme-web.example.com`, state: 'live' },
];
const STEPS: Step[] = ['clone', 'install', 'build', 'predeploy', 'activate'];
const LABEL = { queued: 'Queued', building: 'Building', live: 'Live' } as const;

const log = $('log');
const status = $('status');
const domain = $('domain');
const consoleEl = $('console');
const stepEls = new Map(
  STEPS.map((s) => [s, consoleEl?.querySelector<HTMLElement>(`[data-step="${s}"]`) ?? null]),
);

let timers: number[] = [];
let played = false;

function setState(state: keyof typeof LABEL) {
  if (!status) return;
  status.dataset.state = state;
  status.querySelector('span')!.textContent = LABEL[state];
  domain?.classList.toggle('live', state === 'live');
}

function setStep(step: Step | 'all') {
  const idx = step === 'all' ? STEPS.length : STEPS.indexOf(step);
  STEPS.forEach((s, i) => {
    const el = stepEls.get(s);
    el?.classList.toggle('done', i < idx);
    el?.classList.toggle('active', i === idx);
  });
}

function apply(line: Line, animate: boolean) {
  const span = document.createElement('span');
  span.className = 'ln';
  if (!animate) span.style.animation = 'none';
  span.innerHTML = line.html;
  log!.appendChild(span);
  const over = log!.scrollHeight > log!.clientHeight;
  log!.classList.toggle('overflowing', over);
  if (over) log!.scrollTop = log!.scrollHeight;
  if (line.step) setStep(line.step);
  if (line.state) setState(line.state);
  if (line.state === 'live') setStep('all');
}

function reset() {
  timers.forEach(clearTimeout);
  timers = [];
  if (log) {
    log.innerHTML = '';
    log.classList.remove('overflowing');
  }
  setState('queued');
  STEPS.forEach((s) => stepEls.get(s)?.classList.remove('done', 'active'));
}

function play() {
  if (!log) return;
  reset();
  played = true;
  if (reduceMotion) {
    SCRIPT.forEach((l) => apply(l, false));
    return;
  }
  for (const line of SCRIPT) {
    timers.push(window.setTimeout(() => apply(line, true), line.at + 400));
  }
}

$('replay')?.addEventListener('click', play);

// Start when the console is on screen; stop pending lines if it leaves mid-run.
if (consoleEl && 'IntersectionObserver' in window) {
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && !played) play();
      if (!entry.isIntersecting && timers.length && played) {
        // Finish instantly rather than animating off screen.
        const remaining = SCRIPT.length - (log?.children.length ?? 0);
        if (remaining > 0) {
          timers.forEach(clearTimeout);
          timers = [];
          SCRIPT.slice(SCRIPT.length - remaining).forEach((l) => apply(l, false));
        }
      }
    },
    { threshold: 0.25 },
  ).observe(consoleEl);
} else {
  play();
}
