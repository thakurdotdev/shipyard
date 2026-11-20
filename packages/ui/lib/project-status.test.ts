/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { getProjectStatus } from './project-status';
import type { Project } from './types';

const oldDate = '2026-10-01T10:00:00Z';
const newDate = '2026-10-17T10:00:00Z';
const build: NonNullable<Project['latest_build']> = {
  id: 'new-build',
  status: 'success',
  created_at: newDate,
  completed_at: '2026-10-17T10:01:00Z',
};
const deployment: NonNullable<Project['latest_deployment']> = {
  id: 'old-deployment',
  build_id: 'old-build',
  status: 'active',
  status_message: 'Application is live',
  activated_at: oldDate,
};

describe('overview latest deployment status', () => {
  test.each([
    ['pending', 'Queued', 'progress'],
    ['building', 'Building', 'progress'],
    ['failed', 'Failed', 'error'],
    ['cancelled', 'Skipped', 'neutral'],
    ['success', 'Deploying', 'progress'],
  ] as const)('a newer %s build supersedes an older live deployment', (status, label, tone) => {
    const result = getProjectStatus({
      latest_build: { ...build, status },
      latest_deployment: deployment,
    });
    expect(result.label).toBe(label);
    expect(result.tone).toBe(tone);
    expect(result.timestamp).toBe(build.completed_at);
  });

  test('shows activation failure even when compilation succeeded', () => {
    const result = getProjectStatus({
      latest_build: build,
      latest_deployment: {
        ...deployment,
        build_id: build.id,
        status: 'failed',
        status_message: 'Health check failed',
        activated_at: newDate,
      },
    });
    expect(result.label).toBe('Failed');
    expect(result.tone).toBe('error');
    expect(result.detail).toBe('Health check failed');
    expect(result.timestamp).toBe(newDate);
  });

  test.each([
    'pending',
    'dns_creating',
    'dns_created',
    'ssl_issuing',
    'ssl_issued',
    'nginx_configuring',
    'nginx_configured',
    'app_starting',
    'health_checking',
  ] as const)('shows %s as deployment in progress', (status) => {
    expect(
      getProjectStatus({
        latest_build: build,
        latest_deployment: { ...deployment, build_id: build.id, status },
      }).label,
    ).toBe('Deploying');
  });

  test('uses deployment state and attempt time for successful and stopped deployments', () => {
    for (const [status, label] of [
      ['active', 'Ready'],
      ['inactive', 'Inactive'],
    ] as const) {
      const result = getProjectStatus({
        latest_build: build,
        latest_deployment: { ...deployment, build_id: build.id, status, activated_at: newDate },
      });
      expect(result.label).toBe(label);
      expect(result.timestamp).toBe(newDate);
    }
  });

  test('a new rollback to an older build supersedes the most recent build failure', () => {
    expect(
      getProjectStatus({
        latest_build: { ...build, status: 'failed' },
        latest_deployment: { ...deployment, activated_at: '2026-10-17T10:05:00Z' },
      }).label,
    ).toBe('Ready');
  });

  test('a build retry is not hidden by its previous active deployment', () => {
    expect(
      getProjectStatus({
        latest_build: { ...build, status: 'building' },
        latest_deployment: { ...deployment, build_id: build.id },
      }).label,
    ).toBe('Building');
  });

  test('a project with no attempts is not automatically ready or building', () => {
    const result = getProjectStatus({ latest_build: null, latest_deployment: null });
    expect(result.label).toBe('Not deployed');
    expect(result.timestamp).toBeNull();
    expect(result.tone).toBe('neutral');
  });

  test('shows Down when deployment is active but uptime status is down', () => {
    const result = getProjectStatus({
      latest_build: build,
      latest_deployment: { ...deployment, status: 'active', activated_at: newDate },
      uptime_status: 'down',
    });
    expect(result.label).toBe('Down');
    expect(result.tone).toBe('error');
    expect(result.detail).toBe('Service is down (uptime monitor check failing)');
  });

  test('shows Ready when deployment is active and uptime status is up', () => {
    const result = getProjectStatus({
      latest_build: build,
      latest_deployment: { ...deployment, status: 'active', activated_at: newDate },
      uptime_status: 'up',
    });
    expect(result.label).toBe('Ready');
    expect(result.tone).toBe('success');
  });
});
