import { describe, it, expect, spyOn, mock } from "bun:test";
import { Builder } from "./services/builder";
import { GitService } from "./services/git-service";
import { LogStreamer } from "./services/log-streamer";

// Mock dependencies
mock.module("./services/git-service", () => ({
  GitService: {
    clone: mock(() => Promise.resolve()),
  },
}));

mock.module("./services/log-streamer", () => ({
  LogStreamer: {
    stream: mock(() => Promise.resolve()),
    ensureFlushed: mock(() => Promise.resolve()),
  },
}));

mock.module("./services/artifact-service", () => ({
  ArtifactService: {
    streamArtifact: mock(() => Promise.resolve()),
  },
}));

// Mock Builder.runCommand to avoid actual execution
spyOn(Builder, "runCommand").mockImplementation(() => Promise.resolve());

describe("Build Worker", () => {
  it("should execute build pipeline correctly", async () => {
    const job = {
      build_id: "test-build-id",
      project_id: "test-project-id",
      github_url: "https://github.com/test/repo.git",
      build_command: "bun run build",
      app_type: "nextjs" as const,
      root_directory: "./",
      env_vars: {},
    };

    await Builder.execute(job);

    expect(GitService.clone).toHaveBeenCalledWith(
      job.github_url,
      expect.stringContaining("test-build-id"),
    );
    expect(Builder.runCommand).toHaveBeenCalledWith(
      "bun install",
      expect.any(String),
      job.build_id,
      job.project_id,
      job.env_vars,
    );
    expect(Builder.runCommand).toHaveBeenCalledWith(
      job.build_command,
      expect.any(String),
      job.build_id,
      job.project_id,
      job.env_vars,
    );
    expect(LogStreamer.stream).toHaveBeenCalled();
  });
});
