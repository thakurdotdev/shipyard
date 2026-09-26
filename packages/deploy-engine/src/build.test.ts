import { describe, it, expect, spyOn, mock, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Isolate the build directory and make control-api status calls fail fast.
const TEST_BASE_DIR = join(tmpdir(), `shipyard-build-test-${Date.now()}`);
process.env.BASE_DIR = TEST_BASE_DIR;
process.env.CONTROL_API_URL = 'http://127.0.0.1:9';

// Mock git + log modules BEFORE importing the builder.
mock.module('./services/build/git-service', () => ({
  GitService: {
    clone: mock(async (_url: string, targetDir: string) => {
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(
        join(targetDir, 'package.json'),
        JSON.stringify({ scripts: { build: 'bun run build' } }),
      );
    }),
  },
}));

mock.module('./services/build/log-streamer', () => ({
  LogStreamer: {
    stream: mock(() => Promise.resolve()),
    ensureFlushed: mock(() => Promise.resolve()),
  },
}));

const { Builder } = await import('./services/build/builder');

// Avoid running real install/build commands.
spyOn(Builder, 'runCommand').mockImplementation(() => Promise.resolve());

describe('Deploy Engine builder (in-place build)', () => {
  it('installs and builds exactly once inside the deployment directory', async () => {
    const job = {
      build_id: 'build-test-1',
      project_id: 'project-test-1',
      github_url: 'https://github.com/test/repo.git',
      build_command: 'bun run build',
      root_directory: './',
      app_type: 'nextjs' as const,
      env_vars: {},
    };

    await Builder.execute(job);

    expect(Builder.runCommand).toHaveBeenCalledWith(
      'bun install',
      expect.stringContaining('build-test-1'),
      job.build_id,
      job.project_id,
      job.env_vars,
    );
    expect(Builder.runCommand).toHaveBeenCalledWith(
      job.build_command,
      expect.stringContaining('build-test-1'),
      job.build_id,
      job.project_id,
      job.env_vars,
    );

    const extractDir = join(TEST_BASE_DIR, 'project-test-1', 'builds', 'build-test-1', 'extracted');
    expect(existsSync(join(extractDir, '.shipyard-built'))).toBe(true);
  });

  it('skips rebuilding when the build already completed', async () => {
    const callsBefore = (Builder.runCommand as any).mock.calls.length;

    await Builder.execute({
      build_id: 'build-test-1',
      project_id: 'project-test-1',
      github_url: 'https://github.com/test/repo.git',
      build_command: 'bun run build',
      root_directory: './',
      app_type: 'nextjs' as const,
      env_vars: {},
    });

    expect((Builder.runCommand as any).mock.calls.length).toBe(callsBefore);
  });

  afterAll(() => {
    rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  });
});
