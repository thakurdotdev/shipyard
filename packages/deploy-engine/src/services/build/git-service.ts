import { existsSync, mkdirSync, rmSync } from 'fs';
import simpleGit from 'simple-git';

/**
 * Clones a repository into the deployment directory.
 * When an installation token is provided the repo is cloned over HTTPS using it.
 */
export const GitService = {
  async clone(repoUrl: string, targetDir: string, token?: string) {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    mkdirSync(targetDir, { recursive: true });

    let urlToClone = repoUrl;
    if (token) {
      const urlObj = new URL(repoUrl);
      urlToClone = `https://x-access-token:${token}@${urlObj.hostname}${urlObj.pathname}`;
    }

    const git = simpleGit();
    await git.clone(urlToClone, targetDir);
  },
};
