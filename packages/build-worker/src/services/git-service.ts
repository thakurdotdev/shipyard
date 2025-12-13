import simpleGit from 'simple-git';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

export const GitService = {
  async clone(repoUrl: string, targetDir: string, token?: string) {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    mkdirSync(targetDir, { recursive: true });

    let urlToClone = repoUrl;
    if (token) {
      // repoUrl format: https://github.com/owner/repo OR https://github.com/owner/repo.git
      // We inject token: https://x-access-token:TOKEN@github.com/owner/repo
      const urlObj = new URL(repoUrl);
      urlToClone = `https://x-access-token:${token}@${urlObj.hostname}${urlObj.pathname}`;
    }

    const git = simpleGit();
    await git.clone(urlToClone, targetDir);
  },
};
