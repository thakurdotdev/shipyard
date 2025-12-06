import * as tar from "tar";
import { join } from "path";
import { existsSync } from "fs";
import { unlink } from "fs/promises";

export const ArtifactService = {
  async streamArtifact(
    buildId: string,
    projectDir: string,
    appType: "nextjs" | "vite",
  ) {
    const deployEngineUrl =
      process.env.DEPLOY_ENGINE_URL || "http://localhost:4002";

    // Create a temp file path
    const tempArtifactPath = join(process.cwd(), `temp-${buildId}.tar.gz`);

    let paths: string[] = [];
    if (appType === "nextjs") {
      paths = [
        ".next",
        "public",
        "package.json",
        "bun.lockb",
        "next.config.mjs",
        "next.config.js",
        "out", // Static export output
      ];
    } else if (appType === "vite") {
      paths = ["dist"];
    }

    // Filter paths that exist
    const validPaths = paths.filter((p) => existsSync(join(projectDir, p)));

    if (validPaths.length === 0) {
      throw new Error("No build output found to package");
    }

    try {
      console.log(
        `[ArtifactService] Creating compressed tarball at ${tempArtifactPath}`,
      );

      // Create tarball to file first (more robust than piping streams across fetch)
      await tar.create(
        {
          gzip: true,
          file: tempArtifactPath,
          cwd: projectDir,
        },
        validPaths,
      );

      console.log(
        `[ArtifactService] Uploading ${tempArtifactPath} to ${deployEngineUrl}`,
      );

      const file = Bun.file(tempArtifactPath);

      const response = await fetch(
        `${deployEngineUrl}/artifacts/upload?buildId=${buildId}`,
        {
          method: "POST",
          body: file,
          // No duplex needed for file bodies
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to upload artifact: ${response.statusText}`);
      }

      console.log(
        `[ArtifactService] Upload finished with status ${response.status}`,
      );
    } catch (e) {
      console.error(`[ArtifactService] Upload failed`, e);
      throw e;
    } finally {
      // Cleanup temp file
      if (existsSync(tempArtifactPath)) {
        await unlink(tempArtifactPath);
      }
    }

    return true;
  },
};
