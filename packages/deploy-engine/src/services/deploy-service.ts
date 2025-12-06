import { existsSync, mkdirSync } from "fs";
import { rm, unlink } from "fs/promises";
import { join } from "path";
import { NginxService } from "./nginx-service";

const BASE_DIR = process.env.BASE_DIR || join(process.cwd(), "apps");
const ARTIFACTS_DIR = join(BASE_DIR, "artifacts");

// Ensure artifacts directory exists
if (!existsSync(ARTIFACTS_DIR)) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

export const DeployService = {
  /**
   * Receives a build artifact stream and writes it to disk.
   */
  async receiveArtifact(buildId: string, stream: ReadableStream<any>) {
    const artifactPath = join(ARTIFACTS_DIR, `${buildId}.tar.gz`);
    console.log(`[DeployService] Receiving artifact for build ${buildId}`);

    try {
      const buffer = await new Response(stream).arrayBuffer();
      await Bun.write(artifactPath, buffer);
      console.log(`[DeployService] Artifact stored: ${artifactPath}`);
      return { success: true, path: artifactPath };
    } catch (error) {
      console.error(`[DeployService] Failed to receive artifact:`, error);
      throw error;
    }
  },

  /**
   * Simple health check for the Deploy Engine itself.
   */
  serveRequest(_request: Request) {
    return new Response("Deploy Engine Running", { status: 200 });
  },

  /**
   * Activates a specific deployment:
   * 1. Extracts artifact
   * 2. Kills previous process on port
   * 3. Installs dependencies (cached)
   * 4. Starts the application
   */
  async activateDeployment(
    projectId: string,
    buildId: string,
    port: number,
    appType: "nextjs" | "vite",
    subdomain: string, // NEW: Subdomain required
  ) {
    console.log(
      `[DeployService] Activating ${projectId}:${buildId} on port ${port} (subdomain: ${subdomain})`,
    );

    const paths = this.getPaths(projectId, buildId);

    // 1. Validate Artifact
    if (!existsSync(paths.artifact)) {
      throw new Error(`Artifact not found: ${paths.artifact}`);
    }

    // 2. Prepare Directory
    mkdirSync(paths.extractDir, { recursive: true });

    // 3. Extract
    await this.extractArtifact(paths.artifact, paths.extractDir);

    // 4. Update Symlink (Current Deployment Pointer)
    await this.updateSymlink(paths.projectDir, paths.extractDir, buildId);

    // 5. Ensure Port is Free (Kill any existing process)
    await this.killProjectProcess(projectId, port);

    // 6. Start Application
    await this.startApplication(
      paths.extractDir,
      port,
      appType,
      paths.projectDir,
    );

    // 7. Configure Nginx Proxy
    try {
      console.log(`[DeployService] Configuring Nginx for ${subdomain}...`);
      await NginxService.createConfig(subdomain, port);
    } catch (e) {
      console.error(
        `[DeployService] Failed to configure Nginx for ${subdomain}:`,
        e,
      );
      // We log but don't fail the whole deployment, as the app is running.
      // User might need to fix domain issues manually.
    }

    return { success: true };
  },

  /**
   * Stops a deployment by killing the process on the specified port.
   */
  async stopDeployment(port: number, projectId?: string) {
    console.log(`[DeployService] Stopping deployment on port ${port}`);
    if (projectId) {
      await this.killProjectProcess(projectId, port);
    } else {
      // Fallback for requests that might not have projectId (though our API should always have it)
      await this.ensurePortFree(port);
    }
    return { success: true };
  },

  /**
   * Deletes a project's files and stops its running process.
   */
  async deleteProject(projectId: string, port?: number, subdomain?: string) {
    console.log(`[DeployService] Deleting project ${projectId}`);

    if (port) {
      await this.killProjectProcess(projectId, port);
    }

    const projectDir = join(BASE_DIR, projectId);
    if (existsSync(projectDir)) {
      await rm(projectDir, { recursive: true, force: true });
    }

    // Cleanup Nginx
    if (subdomain) {
      await NginxService.removeConfig(subdomain);
    } else {
      console.warn(
        `[DeployService] No subdomain provided for project ${projectId}. Skipping Nginx cleanup.`,
      );
    }

    return { success: true };
  },

  // --- Private Helpers ---

  getPaths(projectId: string, buildId: string) {
    const projectDir = join(BASE_DIR, projectId);
    return {
      artifact: join(ARTIFACTS_DIR, `${buildId}.tar.gz`),
      projectDir,
      buildDir: join(projectDir, "builds", buildId),
      extractDir: join(projectDir, "builds", buildId, "extracted"),
      currentLink: join(projectDir, "current"),
    };
  },

  async extractArtifact(artifactPath: string, targetDir: string) {
    // Check if already extracted? (Optimization opportunity, but risky if corrupted)
    // For now, assume re-extraction is safer to ensure clean state,
    // unless we want to strictly reuse.
    // User asked "if node_modules exist... skip it".
    // If we re-extract, we might overwrite node_modules if it was packaging it?
    // Current setup: artifact likely DOES NOT contain node_modules.
    // So extracting won't kill node_modules if they are already there?
    // `tar` overwrites. If node_modules is NOT in tar, it stays?
    // Yes.

    console.log(`[DeployService] Extracting to ${targetDir}`);
    const proc = Bun.spawn(["tar", "-xzf", artifactPath, "-C", targetDir]);
    await proc.exited;
    if (proc.exitCode !== 0) throw new Error("Failed to extract artifact");
  },

  async updateSymlink(projectDir: string, targetDir: string, buildId: string) {
    const currentLink = join(projectDir, "current");
    const idFile = join(projectDir, "current_build_id");

    if (existsSync(currentLink)) await unlink(currentLink);

    await Bun.write(idFile, buildId);

    const proc = Bun.spawn(["ln", "-sf", targetDir, currentLink]);
    await proc.exited;
  },

  // NEW: PID-based kill
  async killProjectProcess(projectId: string, port: number) {
    const projectDir = join(BASE_DIR, projectId);
    const pidFile = join(projectDir, "server.pid");

    // 1. Try to kill by PID
    if (existsSync(pidFile)) {
      try {
        const pidStr = await Bun.file(pidFile).text();
        const pid = parseInt(pidStr.trim(), 10);
        if (!isNaN(pid)) {
          console.log(
            `[DeployService] Found PID file for ${projectId}: ${pid}. Killing...`,
          );
          // Check if it's running? kill(0) checks existence
          process.kill(pid, 0); // throws if not found
          process.kill(pid, "SIGKILL"); // Kill it

          // Wait a bit
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch (e) {
        console.log(`[DeployService] PID from file not running or invalid.`);
      }
      // Cleanup pid file
      await unlink(pidFile).catch(() => {});
    }

    // 2. Safety Net: Ensure port is free (handles zombies or missing PID files)
    await this.ensurePortFree(port);
  },

  async killProcessOnPort(
    port: number,
  ): Promise<{ selfFound: boolean; killedCount: number }> {
    try {
      console.log(`[DeployService] Finding PIDs on port ${port}...`);

      // Try lsof first
      let pids: string[] = [];
      try {
        const proc = Bun.spawn(["lsof", "-t", `-i:${port}`, "-sTCP:LISTEN"]);
        const output = await new Response(proc.stdout).text();
        pids = output.trim().split("\n").filter(Boolean);
      } catch (e) {
        console.warn(`[DeployService] lsof failed, trying ss...`);
      }

      // Fallback to ss if lsof failed or found nothing
      if (pids.length === 0) {
        try {
          // ss -lptn 'sport = :PORT'
          const proc = Bun.spawn(["ss", "-lptn", `sport = :${port}`]);
          const output = await new Response(proc.stdout).text();
          // Output format: State Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
          // Example: LISTEN 0 128 *:3000 *:* users:(("bun",pid=12345,fd=12))

          const match = output.match(/pid=(\d+)/g);
          if (match) {
            pids = match.map((m) => m.split("=")[1]);
          }
        } catch (e) {
          console.warn(`[DeployService] ss failed as well.`);
        }
      }

      if (pids.length === 0) {
        console.log(`[DeployService] No process found on port ${port}.`);
        return { selfFound: false, killedCount: 0 };
      }

      // Deduplicate PIDs
      pids = [...new Set(pids)];

      const myPid = process.pid.toString();
      console.log(
        `[DeployService] PIDs on port ${port}: ${pids.join(
          ", ",
        )} (My PID: ${myPid})`,
      );

      const targets = pids.filter((pid) => pid !== myPid);
      const selfFound = targets.length < pids.length;

      if (targets.length === 0) {
        if (selfFound) {
          console.warn(
            `[DeployService] Only self found on port ${port}. Skipping kill to avoid suicide.`,
          );
        }
        return { selfFound, killedCount: 0 };
      }

      console.log(`[DeployService] Killing PIDs: ${targets.join(", ")}`);
      // Kill specific PIDs
      const killProc = Bun.spawn(["kill", "-9", ...targets]);
      await killProc.exited;
      return { selfFound, killedCount: targets.length };
    } catch (e) {
      console.warn(
        `[DeployService] Warning: Failed to kill process on port ${port}`,
        e,
      );
      return { selfFound: false, killedCount: 0 };
    }
  },

  /**
   * Robustly ensures that a port is free by killing any process on it and verifying.
   */
  async ensurePortFree(port: number) {
    console.log(`[DeployService] Ensuring port ${port} is free...`);

    // 1. Initial attempt to kill
    const result = await this.killProcessOnPort(port);
    if (result.selfFound && result.killedCount === 0) {
      throw new Error(
        `Port ${port} is in use by the Deploy Engine itself! Cannot stop. Check your configuration.`,
      );
    }

    // 2. Verify loop
    let retries = 10;
    while (retries > 0) {
      let isFree = false;

      // Check 1: lsof
      try {
        const proc = Bun.spawn(["lsof", "-t", `-i:${port}`, "-sTCP:LISTEN"]);
        const output = await new Response(proc.stdout).text();
        if (!output.trim()) isFree = true;
      } catch (e) {
        // lsof failure usually implies empty
        isFree = true;
      }

      // Check 2: HTTP Connectivity (The ultimate truth)
      if (isFree) {
        try {
          // If we can connect, it's NOT free.
          const res = await fetch(`http://localhost:${port}`);
          if (res.ok || res.status < 500) {
            isFree = false; // It's alive!
          }
        } catch (e) {
          // Connection refused = It's truly dead.
          isFree = true;
        }
      }

      if (isFree) {
        console.log(`[DeployService] Verified port ${port} is free.`);
        return;
      }

      console.log(
        `[DeployService] Port ${port} is still in use. Retrying cleanup...`,
      );
      // Force kill again just in case
      const retryResult = await this.killProcessOnPort(port);
      if (retryResult.selfFound && retryResult.killedCount === 0) {
        throw new Error(
          `Port ${port} is in use by the Deploy Engine itself! Cannot stop.`,
        );
      }

      await new Promise((r) => setTimeout(r, 500));
      retries--;
    }

    throw new Error(`Could not free up port ${port} after multiple attempts.`);
  },

  async startApplication(
    cwd: string,
    port: number,
    appType: "nextjs" | "vite",
    projectDir: string, // Pass projectDir to write PID
  ) {
    let startCmd: string[];
    let isStatic = false;

    // Detect Static Next.js (output: export)
    // If 'out' directory exists, we treat it as a static site
    const staticNextPath = join(cwd, "out");
    const isStaticNext = appType === "nextjs" && existsSync(staticNextPath);

    if (appType === "vite" || isStaticNext) {
      console.log(
        `[DeployService] Detected Static App (${
          isStaticNext ? "Next.js Export" : "Vite"
        })`,
      );
      isStatic = true;
      const serverScript = join(process.cwd(), "src", "static-server.ts");
      // Use 'out' for Next.js, 'dist' for Vite
      const distDir = join(cwd, isStaticNext ? "out" : "dist");
      startCmd = ["bun", "run", serverScript, distDir, port.toString()];
    } else {
      // Standard Next.js (SSR)
      console.log(`[DeployService] Detected SSR App (Next.js)`);

      // OPTIMIZATION: Skip install if node_modules exists
      const nodeModulesPath = join(cwd, "node_modules");
      if (existsSync(nodeModulesPath)) {
        console.log(`[DeployService] node_modules found. Skipping install.`);
      } else {
        console.log(`[DeployService] Installing dependencies...`);
        const installProc = Bun.spawn(["bun", "install", "--production"], {
          cwd,
          stdout: "inherit",
          stderr: "inherit",
        });
        await installProc.exited;
        if (installProc.exitCode !== 0)
          throw new Error("Dependency install failed");
      }

      startCmd = ["bun", "run", "start", "--", "--port", port.toString()];
    }

    // Spawn detached process
    console.log(`[DeployService] Spawning process on port ${port} (detached)`);

    const appProc = Bun.spawn(startCmd, {
      cwd: appType === "nextjs" && !isStatic ? cwd : process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
      detached: true, // Native Bun detachment
      env: { ...process.env, PORT: port.toString() },
    });

    // Write PID file
    const pidFile = join(projectDir, "server.pid");
    await Bun.write(pidFile, appProc.pid.toString());
    console.log(`[DeployService] PID ${appProc.pid} written to ${pidFile}`);

    // IMPORTANT: We must unref() the child process so the parent doesn't wait for it?
    // Bun Subprocess object: `unref()`
    appProc.unref();

    // Health Check
    await this.performHealthCheck(port);
  },

  async performHealthCheck(port: number) {
    console.log(`[DeployService] Waiting for health check on port ${port}...`);
    let retries = 20; // Increased retries for slower starts
    while (retries > 0) {
      try {
        const res = await fetch(`http://localhost:${port}`);
        if (res.ok || res.status < 500) {
          console.log(`[DeployService] Health check passed.`);
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
      retries--;
    }
    throw new Error("Health check failed: Application did not start in time.");
  },
};
