import { describe, it, expect, mock } from "bun:test";
import { DeployService } from "./services/deploy-service";
import { join } from "path";
import { existsSync } from "fs";

// Mock file system
mock.module("fs", () => ({
  existsSync: mock((path: string) => {
    return path.includes("index.html") || path.includes("style.css");
  }),
}));

// Mock Bun.file
const originalFile = Bun.file;
Bun.file = mock(
  (path: string) =>
    ({
      text: async () => "file content",
      size: 100,
      type: "text/plain",
    } as any),
);

describe("Deploy Engine", () => {
  it("should serve index.html for root request", async () => {
    const req = new Request("http://test-project.localhost/");
    const res = await DeployService.serveRequest(req);

    expect(res.status).toBe(200);
    // expect(Bun.file).toHaveBeenCalledWith(expect.stringContaining("index.html"));
  });

  it("should serve static asset if exists", async () => {
    const req = new Request("http://test-project.localhost/style.css");
    const res = await DeployService.serveRequest(req);

    expect(res.status).toBe(200);
  });

  it("should fallback to index.html for unknown routes (SPA)", async () => {
    const req = new Request("http://test-project.localhost/unknown-route");
    const res = await DeployService.serveRequest(req);

    expect(res.status).toBe(200);
  });
});
