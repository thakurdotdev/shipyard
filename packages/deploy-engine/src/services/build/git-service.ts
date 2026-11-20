import { mkdir } from 'fs/promises';
import { removeAppTree } from '../app-user';
import simpleGit from 'simple-git';

/** What to check out. Both are optional: without them the default branch head is used. */
export interface CloneTarget {
  branch?: string;
  /** Full commit SHA; the checkout is left detached at it. */
  commit?: string;
}

/** Full SHA-1 or SHA-256 object name, lowercase as GitHub sends it. */
export function isCommitSha(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

/**
 * Rejects what `git check-ref-format` rejects that could matter here: option-like names,
 * whitespace and control characters, and ref syntax (`..`, `@{`, `~^:?*[\`).
 */
export function isSafeBranchName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !value.startsWith('-') &&
    !value.includes('..') &&
    !value.includes('@{') &&
    !/[\x00-\x20\x7f~^:?*[\\]/.test(value)
  );
}

/**
 * Clones a repository into the deployment directory.
 * When an installation token is provided the repo is cloned over HTTPS using it.
 */
export const GitService = {
  async clone(
    repoUrl: string,
    targetDir: string,
    token?: string,
    onProgress?: (message: string) => void,
    target: CloneTarget = {},
  ) {
    if (target.branch !== undefined && !isSafeBranchName(target.branch)) {
      throw new Error(`Invalid branch name: ${JSON.stringify(target.branch)}`);
    }
    if (target.commit !== undefined && !isCommitSha(target.commit)) {
      throw new Error(`Invalid commit SHA: ${JSON.stringify(target.commit)}`);
    }

    // The token travels as an HTTP header set through git's environment, never in the
    // URL: a URL credential is visible to every local account in the process list and is
    // saved in .git/config, where the build scripts that run next could read it.
    const auth = token ? gitAuthEnv(repoUrl, token) : {};

    const startedAt = performance.now();
    let lastReportAt = startedAt;
    let phase = 'Preparing repository directory';
    const report = (message: string) => {
      lastReportAt = performance.now();
      onProgress?.(
        `[${new Date().toISOString()}] ${message} (${((lastReportAt - startedAt) / 1000).toFixed(1)}s elapsed)`,
      );
    };
    // Git can spend time connecting before it emits transfer progress. Keep that
    // interval visible, and include producer timestamps to expose delayed delivery.
    const heartbeat = setInterval(() => {
      if (performance.now() - lastReportAt >= 5000) report(`${phase}...`);
    }, 5000);

    try {
      report(phase);
      // A retry may contain a large partial checkout/node_modules tree. Removing
      // it synchronously blocks all build log flushing on the worker's event loop.
      await removeAppTree(targetDir);
      await mkdir(targetDir, { recursive: true });
      const cloneStartedAt = performance.now();
      report(
        `Repository directory prepared in ${((cloneStartedAt - startedAt) / 1000).toFixed(1)}s`,
      );

      phase = 'Git connecting/downloading repository';
      report(phase);
      let previousStage = '';
      const git = simpleGit({
        // Only the platform sets these config variables (gitAuthEnv); none come from users.
        unsafe: { allowUnsafeConfigEnvCount: true },
        progress: ({ stage, progress, processed, total }) => {
          phase = `Git ${stage}: ${progress}% (${processed}/${total})`;
          if (stage !== previousStage || performance.now() - lastReportAt >= 5000) {
            previousStage = stage;
            report(phase);
          }
        },
      });
      if (token) git.env({ ...gitBaseEnv(), ...auth });
      const cloneArgs = ['--progress'];
      if (target.branch) cloneArgs.push('--branch', target.branch, '--single-branch');
      await git.clone(repoUrl, targetDir, cloneArgs);
      report(`Git clone completed in ${((performance.now() - cloneStartedAt) / 1000).toFixed(1)}s`);

      if (target.commit) {
        const short = target.commit.slice(0, 7);
        phase = `Checking out commit ${short}`;
        report(phase);
        const repo = simpleGit({ baseDir: targetDir, unsafe: { allowUnsafeConfigEnvCount: true } });
        if (token) repo.env({ ...gitBaseEnv(), ...auth });
        try {
          await repo.checkout(['--detach', target.commit]);
        } catch {
          // Not in the cloned history (e.g. force-pushed away): ask the remote for it.
          phase = `Fetching commit ${short}`;
          report(phase);
          await repo.fetch(['origin', target.commit]);
          await repo.checkout(['--detach', target.commit]);
        }
        report(`Checked out commit ${short}`);
      }
    } finally {
      clearInterval(heartbeat);
    }
  },
};

/** Minimal environment for git: simple-git refuses inherited editor/pager overrides. */
function gitBaseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
    const value = process.env[key];
    if (value) out[key] = value;
  }
  return out;
}

/** git config (via GIT_CONFIG_*) that authenticates HTTPS requests to the repo's host. */
export function gitAuthEnv(repoUrl: string, token: string): Record<string, string> {
  const { protocol, host } = new URL(repoUrl);
  if (protocol !== 'https:') throw new Error('Authenticated clones require an https:// URL');
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.https://${host}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    GIT_TERMINAL_PROMPT: '0',
  };
}
