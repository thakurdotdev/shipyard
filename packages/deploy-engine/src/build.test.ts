import { describe, it, expect, spyOn, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Isolate the build directory and make control-api status calls fail fast.
// Must happen before the dynamic imports below: paths.ts captures BASE_DIR at import time.
const TEST_BASE_DIR = join(tmpdir(), `shipyard-build-test-${Date.now()}`);
process.env.BASE_DIR = TEST_BASE_DIR;
process.env.CONTROL_API_URL = 'http://127.0.0.1:9';

// Spies instead of mock.module so the overrides never leak into other test files.
const { Builder } = await import('./services/build/builder');
const { GitService } = await import('./services/build/git-service');
const { LogStreamer } = await import('./services/build/log-streamer');

const cloneSpy = spyOn(GitService, 'clone').mockImplementation(
  async (_url: string, targetDir: string) => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'bun run build' } }),
    );
  },
);
const streamSpy = spyOn(LogStreamer, 'stream').mockImplementation(() => Promise.resolve());
const flushSpy = spyOn(LogStreamer, 'ensureFlushed').mockImplementation(() => Promise.resolve());
// Avoid running real install/build commands.
const runCommandSpy = spyOn(Builder, 'runCommand').mockImplementation(() => Promise.resolve());

const restoreSpies = () => {
  cloneSpy.mockRestore();
  streamSpy.mockRestore();
  flushSpy.mockRestore();
  runCommandSpy.mockRestore();
};

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

    // Next to the checkout, which the app user owns when isolation is on.
    const buildRoot = join(TEST_BASE_DIR, 'project-test-1', 'builds', 'build-test-1');
    expect(existsSync(join(buildRoot, '.shipyard-built'))).toBe(true);
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

  it('fails a Vite build command that does not produce dist/index.html', async () => {
    await expect(
      Builder.execute({
        build_id: 'vite-without-output',
        project_id: 'project-test-1',
        github_url: 'https://github.com/test/repo.git',
        build_command: 'bun run build',
        root_directory: './',
        app_type: 'vite',
        env_vars: {},
      }),
    ).rejects.toThrow('Static build output missing');
    expect(
      existsSync(
        join(TEST_BASE_DIR, 'project-test-1', 'builds', 'vite-without-output', 'extracted'),
      ),
    ).toBe(false);
  });

  afterAll(() => {
    restoreSpies();
    rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  });
});
