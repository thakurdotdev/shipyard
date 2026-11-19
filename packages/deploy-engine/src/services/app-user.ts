/**
 * Runs deployed-application code as an unprivileged OS account.
 *
 * The platform (this engine, the Control API) runs as an account with sudo. Builds
 * (`bun install` runs dependency postinstall scripts), pre-deploy commands and the apps
 * themselves are untrusted, so when SHIPYARD_APP_USER is set they run as that account
 * instead, through `sudo -u`. scripts/isolate-apps.sh creates the account, its pm0 daemon
 * and the sudoers rule. Left unset, everything runs as the platform user as before.
 *
 * Ownership model: a build's checkout (`builds/<id>/extracted`) belongs to the app user
 * once cloned; everything above it (`builds/<id>`, the `current` link, Nginx files) stays
 * with the platform. The platform never executes or writes through files inside a
 * checkout, since the app user can change them.
 */
import { spawn, spawnSync } from 'child_process';
import { realpathSync, statSync } from 'fs';
import { rm } from 'fs/promises';
import { join, sep } from 'path';
import { BASE_DIR } from '../config/paths';

/** The app account, or '' when isolation is off. Read per call so tests can toggle it. */
export function appUser(): string {
  return (process.env.SHIPYARD_APP_USER || '').trim();
}

/** Home of the app user (pm0 state, scratch files). */
export function appUserHome(): string {
  return (process.env.SHIPYARD_APP_HOME || `/var/lib/${appUser()}`).trim();
}

/** PATH for commands run as the app user: shared runtimes, never the platform's home. */
export const APP_USER_PATH = '/usr/local/bin:/usr/bin:/bin';

/** Interface deployed apps are told to listen on (HOST / HOSTNAME / --hostname). */
export const APP_BIND_HOST = (process.env.APP_BIND_HOST || '127.0.0.1').trim();

export function isAppUserEnabled(): boolean {
  return appUser().length > 0;
}

/**
 * argv that runs `argv` as the app user. With `preserveEnv`, the caller's environment
 * (project env vars) is passed through sudo -E rather than on the command line, where
 * every local account could read it; PATH is pinned because sudo's secure_path and the
 * platform's own PATH (a private home) would otherwise apply.
 */
export function asAppUser(argv: string[], options: { preserveEnv?: boolean } = {}): string[] {
  if (!isAppUserEnabled()) return argv;
  return [
    'sudo',
    '-n',
    '-H',
    ...(options.preserveEnv ? ['-E'] : []),
    '-u',
    appUser(),
    '--',
    ...(options.preserveEnv ? ['env', `PATH=${APP_USER_PATH}`] : []),
    ...argv,
  ];
}

/** Environment for a sudo -E child: the given vars, with platform-home paths removed. */
export function appUserEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    // nvm/bun shims and similar point into the platform's home, which the app user
    // cannot read; sudo -H sets HOME itself.
    if (key === 'HOME' || key === 'PATH' || key.startsWith('NVM_') || key === 'PM0_HOME') continue;
    out[key] = value;
  }
  return out;
}

async function run(argv: string[], input?: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => resolve({ code: 1, stderr: e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stderr: stderr.trim() }));
    if (input !== undefined) child.stdin?.end(input);
  });
}

const cachedUids = new Map<string, number | null>();
function appUserUid(): number | null {
  if (cachedUids.has(appUser())) return cachedUids.get(appUser())!;
  const res = spawnSync('id', ['-u', appUser()], { encoding: 'utf8' });
  const uid = res.status === 0 ? Number(res.stdout.trim()) : null;
  cachedUids.set(appUser(), uid);
  return uid;
}

/** Resolve `dir` and require it to be a checkout under BASE_DIR, not BASE_DIR itself. */
function checkedAppPath(dir: string): string {
  const base = realpathSync(BASE_DIR);
  const real = realpathSync(dir);
  if (!real.startsWith(base + sep) || real.split(sep).length < base.split(sep).length + 2) {
    throw new Error(`Refusing to hand ${dir} to ${appUser()}: not a deployment directory`);
  }
  return real;
}

/**
 * Give a freshly cloned (or legacy, platform-owned) checkout to the app user, so builds
 * and the running app can write in it. A no-op when isolation is off or already done.
 */
export async function claimForAppUser(dir: string): Promise<void> {
  if (!isAppUserEnabled()) return;
  const uid = appUserUid();
  if (uid === null) throw new Error(`SHIPYARD_APP_USER "${appUser()}" does not exist`);
  const real = checkedAppPath(dir);
  if (statSync(real).uid === uid) return;
  // -R without -L never follows symlinks; --no-dereference changes links themselves.
  const res = await run([
    'sudo',
    '-n',
    'chown',
    '-R',
    '--no-dereference',
    `${appUser()}:${appUser()}`,
    '--',
    real,
  ]);
  if (res.code !== 0) throw new Error(`Could not hand ${real} to ${appUser()}: ${res.stderr}`);
}

/**
 * Delete a directory that may contain files owned by the app user. The app user empties
 * what it owns first; the platform removes the rest (its own files and the now-empty
 * directories it has write access to).
 */
export async function removeAppTree(dir: string): Promise<void> {
  if (isAppUserEnabled()) {
    await run(asAppUser(['rm', '-rf', '--', dir]));
  }
  await rm(dir, { recursive: true, force: true });
}

/** Write a file inside an app-owned checkout (as the app user, never through its links). */
export async function writeAppFile(path: string, content: string): Promise<void> {
  if (!isAppUserEnabled()) {
    await Bun.write(path, content);
    return;
  }
  const res = await run(
    asAppUser(['sh', '-c', 'rm -f -- "$1" && umask 022 && cat > "$1"', 'sh', path]),
    content,
  );
  if (res.code !== 0) throw new Error(`Could not write ${path}: ${res.stderr}`);
}

/** Read a file the app user owns but the platform may not be able to read (pm0 logs). */
export async function readAppFileTail(path: string, lines: number): Promise<string> {
  const argv = asAppUser(['tail', '-n', String(lines), '--', path]);
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(out));
  });
}

/** Scratch directory owned by the app user (pm0 ecosystem files). */
export function appUserRunDir(): string {
  return join(appUserHome(), 'run');
}
