import * as tar from 'tar';
import { join } from 'path';
import { existsSync, readdirSync, mkdirSync } from 'fs';
import { unlink, cp } from 'fs/promises';
import { AppType, getExistingArtifactPaths, isBackendFramework } from '../config/framework-config';

export const ArtifactService = {
  /**
   * Resolves the local BASE_DIR for deployments if available on the same machine.
   */
  getLocalBaseDir(): string | null {
    if (process.env.BASE_DIR && existsSync(process.env.BASE_DIR)) {
      return process.env.BASE_DIR;
    }
    // Check monorepo sibling path: packages/deploy-engine/apps
    const siblingPath = join(process.cwd(), '..', 'deploy-engine', 'apps');
    if (existsSync(siblingPath)) {
      return siblingPath;
    }
    return null;
  },

  /**
   * Stores the build output:
   * 1. Fast path: Copies directly to the deploy engine apps directory if on the same machine.
   * 2. Remote fallback: Creates a compressed tarball and streams it over HTTP.
   */
  async streamArtifact(
    buildId: string,
    projectId: string,
    projectDir: string,
    appType: AppType,
    onProgress?: (msg: string) => Promise<void>,
  ) {
    const deployEngineUrl = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';
    const isLocalDeploy =
      deployEngineUrl.includes('localhost') ||
      deployEngineUrl.includes('127.0.0.1') ||
      deployEngineUrl.includes('::1');

    let validPaths: string[];

    if (isBackendFramework(appType)) {
      // For backend: include everything except node_modules
      validPaths = readdirSync(projectDir).filter((f) => f !== 'node_modules' && f !== '.git');
      console.log(`[ArtifactService] Backend app - packaging all files except node_modules`);
    } else {
      // For frontend: use selective paths from config
      validPaths = getExistingArtifactPaths(appType, projectDir);
    }

    if (validPaths.length === 0) {
      throw new Error('No build output found to package');
    }

    const localBaseDir = this.getLocalBaseDir();

    // ─── Fast-Path: Direct Local Placement (Single Server) ────────
    if (isLocalDeploy && localBaseDir && projectId) {
      const startTime = Date.now();
      const targetDir = join(localBaseDir, projectId, 'builds', buildId, 'extracted');
      console.log(`[ArtifactService] Fast path: copying directly to ${targetDir}`);

      if (onProgress) {
        await onProgress(
          `📦 Saving build output directly to deployment directory (fast-path)...\n`,
        );
      }

      mkdirSync(targetDir, { recursive: true });

      for (const relPath of validPaths) {
        const src = join(projectDir, relPath);
        const dest = join(targetDir, relPath);
        if (existsSync(src)) {
          await cp(src, dest, { recursive: true });
        }
      }

      const elapsedMs = Date.now() - startTime;
      console.log(
        `[ArtifactService] Fast path completed: ${validPaths.length} items copied in ${elapsedMs}ms`,
      );
      if (onProgress) {
        await onProgress(`⚡ Artifact prepared in ${elapsedMs}ms (zero-tar fast path)\n`);
      }

      return true;
    }

    // ─── Remote Fallback: Tarball & HTTP Stream ────────────────────
    const tempArtifactPath = join(process.cwd(), `temp-${buildId}.tar.gz`);

    try {
      console.log(`[ArtifactService] Creating tarball with paths: ${validPaths.join(', ')}`);
      if (onProgress) {
        await onProgress(`Creating artifact package...\n`);
      }

      await tar.create(
        {
          gzip: true,
          file: tempArtifactPath,
          cwd: projectDir,
        },
        validPaths,
      );

      console.log(`[ArtifactService] Uploading artifact to ${deployEngineUrl}`);
      if (onProgress) {
        await onProgress(`Streaming artifact to Deploy Engine...\n`);
      }

      const file = Bun.file(tempArtifactPath);

      const response = await fetch(`${deployEngineUrl}/artifacts/upload?buildId=${buildId}`, {
        method: 'POST',
        body: file,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload artifact: ${response.statusText}`);
      }

      console.log(`[ArtifactService] Upload completed successfully`);
      if (onProgress) {
        await onProgress(`Artifact uploaded successfully!\n`);
      }
    } catch (e) {
      console.error(`[ArtifactService] Upload failed`, e);
      throw e;
    } finally {
      if (existsSync(tempArtifactPath)) {
        await unlink(tempArtifactPath);
      }
    }

    return true;
  },
};
