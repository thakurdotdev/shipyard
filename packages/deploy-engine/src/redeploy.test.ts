import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { DeployService } from "./services/deploy-service";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { bunExe } from "./test-utils"; // Assuming hypothetical util, or just use "bun"

// Mock constants/env if needed or just rely on the service using process.cwd()
// We might need to adjust BASE_DIR env var for safety
process.env.BASE_DIR = join(process.cwd(), "test-workspace");
const TEST_PORT = 9001;

describe("Redeploy Flow", () => {
  const projectId = "test-redeploy-project";
  const buildId1 = "build-1";
  const buildId2 = "build-2";

  test("Should start first deployment cleanly", async () => {
    // Setup artifact mock
    // We'll just manually create the 'extracted' dir to skip artifact logic for now
    // or mock the extract method.
    // Actually, let's use the real service but mock the "extraction" to just creating a dummy server.ts

    const paths1 = DeployService.getPaths(projectId, buildId1);
    mkdirSync(paths1.extractDir, { recursive: true });

    // Create a simple HTTP server script
    const script = `
            const port = parseInt(process.env.PORT || "${TEST_PORT}");
            console.log("Starting test server on " + port);
            Bun.serve({
                port: port,
                fetch(req) { return new Response("Hello v1"); }
            });
        `;
    // We need to write this to a file that 'startApplication' will run.
    // startApplication looks for package.json or mimics 'bun run start'.
    // For simplicity, let's look at startApplication logic.
    // It runs "bun run start" or "static-server".
    // Let's create a package.json with a start script.
    writeFileSync(
      join(paths1.extractDir, "package.json"),
      JSON.stringify({
        scripts: {
          start: "bun run server.ts",
        },
      }),
    );
    writeFileSync(join(paths1.extractDir, "server.ts"), script);

    // Act
    // We skip extract/symlink steps and call startApplication directly or verify ensurePortFree works.
    // Let's assume activateDeployment calls them all.
    // We need to mock 'extractArtifact' to do nothing as we pre-filled it?
    // Or just create a dummy tarball.
    // Let's just monitor 'killProcessOnPort' and 'startApplication'.

    // Let's call startApplication directly to simulate "Start V1"
    await DeployService.startApplication(
      paths1.extractDir,
      TEST_PORT,
      "nextjs",
      paths1.projectDir,
    );

    // Assert V1 is running
    const res = await fetch(`http://localhost:${TEST_PORT}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello v1");
  });

  test("Should restart (redeploy) on same port", async () => {
    // Prepare V2
    const paths2 = DeployService.getPaths(projectId, buildId2);
    mkdirSync(paths2.extractDir, { recursive: true });
    const script = `
            const port = parseInt(process.env.PORT || "${TEST_PORT}");
            console.log("Starting test server v2 on " + port);
            Bun.serve({
                port: port,
                fetch(req) { return new Response("Hello v2"); }
            });
        `;
    writeFileSync(
      join(paths2.extractDir, "package.json"),
      JSON.stringify({
        scripts: {
          start: "bun run server.ts",
        },
      }),
    );
    writeFileSync(join(paths2.extractDir, "server.ts"), script);

    // Perform "Stop/Kill" then "Start" (simulating activateDeployment logic)
    // 1. Kill old
    await DeployService.killProjectProcess(projectId, TEST_PORT);

    // Verify dead
    try {
      await fetch(`http://localhost:${TEST_PORT}`);
      throw new Error("Should be down");
    } catch (e) {
      expect(e).toBeTruthy(); // Connection refused
    }

    // 2. Start New
    await DeployService.startApplication(
      paths2.extractDir,
      TEST_PORT,
      "nextjs",
      paths2.projectDir,
    );

    // Assert V2 is running
    const res = await fetch(`http://localhost:${TEST_PORT}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello v2");
  });

  afterAll(async () => {
    // Cleanup
    await DeployService.killProcessOnPort(TEST_PORT);
    await Bun.spawn(["rm", "-rf", "test-workspace"]).exited;
  });
});
