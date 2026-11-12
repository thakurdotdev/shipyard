import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** Written next to the app by the builder; tells the deploy engine what to start. */
export const GO_BUILD_MARKER = '.shipyard-go.json';

export interface GoBuildInfo {
  /** Binary path relative to the app directory. */
  binary: string;
  /** Package that was compiled, e.g. "." or "./cmd/server". */
  package: string;
}

/** go build flags that take a separate value argument. */
const FLAGS_WITH_VALUE = new Set([
  '-o',
  '-ldflags',
  '-gcflags',
  '-asmflags',
  '-gccgoflags',
  '-tags',
  '-mod',
  '-modfile',
  '-p',
  '-pkgdir',
  '-buildmode',
  '-compiler',
  '-overlay',
  '-pgo',
  '-installsuffix',
  '-toolexec',
  '-C',
]);

/** Splits a command line on whitespace, honouring single and double quotes. */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken || current) tokens.push(current);
      current = '';
      hasToken = false;
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken || current) tokens.push(current);
  return tokens;
}

/**
 * Reads the output path and package from the `go build` step of a build command.
 * Only the first `go build` in an `&&` chain is considered.
 */
export function parseGoBuildCommand(command: string): { output?: string; package: string } {
  for (const part of command.split('&&')) {
    const tokens = tokenize(part.trim());
    const start = tokens.findIndex((t, i) => t === 'go' && tokens[i + 1] === 'build');
    if (start === -1) continue;

    let output: string | undefined;
    const packages: string[] = [];
    for (let i = start + 2; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith('-')) {
        const [flag, inline] = token.replace(/^--/, '-').split(/=(.*)/s, 2);
        const value = inline ?? (FLAGS_WITH_VALUE.has(flag) ? tokens[++i] : undefined);
        if (flag === '-o') output = value;
        continue;
      }
      packages.push(token);
    }
    return { output, package: packages[0] ?? '.' };
  }
  return { package: '.' };
}

/** Major.minor Go version from go.mod's `go` directive, e.g. "1.23". */
export function readGoVersion(appDir: string): string | null {
  const goMod = join(appDir, 'go.mod');
  if (!existsSync(goMod)) return null;
  const match = readFileSync(goMod, 'utf-8').match(/^go\s+(\d+\.\d+)/m);
  return match?.[1] ?? null;
}

export function readGoBuildInfo(appDir: string): GoBuildInfo | null {
  try {
    const info = JSON.parse(readFileSync(join(appDir, GO_BUILD_MARKER), 'utf-8'));
    if (typeof info?.binary !== 'string' || typeof info?.package !== 'string') return null;
    return info;
  } catch {
    return null;
  }
}

export function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
