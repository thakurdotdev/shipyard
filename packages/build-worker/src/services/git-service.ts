import simpleGit from "simple-git";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

export const GitService = {
  async clone(repoUrl: string, targetDir: string) {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    mkdirSync(targetDir, { recursive: true });

    const git = simpleGit();
    await git.clone(repoUrl, targetDir);
  },
};
