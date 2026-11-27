/**
 * Docker Service Tests
 */

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { execDocker, isDockerAvailable } from './exec';
import { getContainerName, getImageName, DEFAULT_CONTAINER_LIMITS } from './types';

describe('Docker Types', () => {
  test('getContainerName generates valid name', () => {
    const name = getContainerName('abc12345-6789-0abc-def0-123456789abc');
    expect(name).toBe('shipyard-abc12345');
    expect(name.length).toBeLessThan(64); // Docker name limit
  });

  test('getImageName generates valid tag', () => {
    const image = getImageName('project-123', 'build-456');
    expect(image).toBe('shipyard/project-:build-45');
  });

  test('DEFAULT_CONTAINER_LIMITS has expected values', () => {
    expect(DEFAULT_CONTAINER_LIMITS.memory).toBe('512m');
    expect(DEFAULT_CONTAINER_LIMITS.cpus).toBe('0.5');
  });
});

describe('Docker Exec', () => {
  test('isDockerAvailable returns boolean', async () => {
    const available = await isDockerAvailable();
    expect(typeof available).toBe('boolean');
  });

  test('execDocker returns structured result', async () => {
    // This will fail if Docker isn't installed, which is fine for CI
    const result = await execDocker(['version']);
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('exitCode');
    expect(typeof result.exitCode).toBe('number');
  });
});

// Integration tests (require Docker)
describe.skipIf(!(await isDockerAvailable()))('Docker Integration', () => {
  const testImageName = 'shipyard/test:latest';

  // These tests require Docker and are skipped in CI
  test('can pull a base image', async () => {
    const result = await execDocker(['pull', 'alpine:latest']);
    expect(result.exitCode).toBe(0);
  });
});
