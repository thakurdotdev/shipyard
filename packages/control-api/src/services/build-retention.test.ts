import { describe, expect, it } from 'bun:test';
import { selectBuildsToPrune } from './build-retention';

const build = (id: string, minutesAgo: number, status = 'success') => ({
  id,
  status,
  created_at: new Date(Date.now() - minutesAgo * 60_000),
});

// Newest first: b1 is the most recent.
const history = [
  build('b1', 1),
  build('b2', 2),
  build('b3', 3, 'failed'),
  build('b4', 4),
  build('b5', 5),
];

describe('selectBuildsToPrune', () => {
  it('keeps every build when retention is off', () => {
    expect(selectBuildsToPrune(history, null, 'b1')).toEqual([]);
    expect(selectBuildsToPrune(history, undefined, 'b1')).toEqual([]);
  });

  it('deletes everything past the newest N, failed builds included', () => {
    expect(selectBuildsToPrune(history, 2, 'b1')).toEqual(['b3', 'b4', 'b5']);
    expect(selectBuildsToPrune(history, 3, 'b1')).toEqual(['b4', 'b5']);
  });

  it('never deletes the live build, even when it is old', () => {
    expect(selectBuildsToPrune(history, 2, 'b5')).toEqual(['b3', 'b4']);
  });

  it('never deletes queued or running builds', () => {
    const withRunning = [...history, build('b6', 6, 'building'), build('b7', 7, 'pending')];
    expect(selectBuildsToPrune(withRunning, 2, 'b1')).toEqual(['b3', 'b4', 'b5']);
  });

  it('does not depend on input order', () => {
    expect(selectBuildsToPrune([...history].reverse(), 2, 'b1')).toEqual(['b3', 'b4', 'b5']);
  });

  it('refuses limits below the minimum, so a rollback target always remains', () => {
    expect(selectBuildsToPrune(history, 1, 'b1')).toEqual([]);
    expect(selectBuildsToPrune(history, 0, 'b1')).toEqual([]);
  });

  it('does nothing when there are fewer builds than the limit', () => {
    expect(selectBuildsToPrune(history.slice(0, 2), 3, 'b1')).toEqual([]);
  });
});
