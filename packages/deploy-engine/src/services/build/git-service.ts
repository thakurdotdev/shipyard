import { mkdir } from 'fs/promises';
import { removeAppTree } from '../app-user';
import simpleGit from 'simple-git';

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
  ) {
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
      report(`Repository directory prepared in ${((cloneStartedAt - startedAt) / 1000).toFixed(1)}s`);

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
      await git.clone(repoUrl, targetDir, ['--progress']);
      report(`Git clone completed in ${((performance.now() - cloneStartedAt) / 1000).toFixed(1)}s`);
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
