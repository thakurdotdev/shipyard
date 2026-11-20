import { describe, expect, it } from 'bun:test';
import { selectSupersededJobs } from './supersede';

const job = (id: string, project_id: string, timestamp: number) => ({
  id,
  timestamp,
  data: { build_id: id, project_id },
});

describe('selectSupersededJobs', () => {
  it('drops only the same project’s builds queued before the newer one', () => {
    const waiting = [
      job('a1', 'project-a', 100),
      job('b1', 'project-b', 150),
      job('a2', 'project-a', 200),
      job('a3', 'project-a', 300),
    ];
    const superseded = selectSupersededJobs(waiting, job('a3', 'project-a', 300));
    expect(superseded.map((j) => j.id)).toEqual(['a1', 'a2']);
  });

  it('never drops a build queued later than the newer one', () => {
    const waiting = [job('a1', 'project-a', 100), job('a3', 'project-a', 300)];
    expect(selectSupersededJobs(waiting, job('a2', 'project-a', 200)).map((j) => j.id)).toEqual([
      'a1',
    ]);
  });

  it('keeps both builds when they were queued in the same millisecond', () => {
    const waiting = [job('a1', 'project-a', 100), job('a2', 'project-a', 100)];
    expect(selectSupersededJobs(waiting, job('a2', 'project-a', 100))).toEqual([]);
  });

  it('leaves other projects alone', () => {
    const waiting = [job('b1', 'project-b', 100), job('c1', 'project-c', 100)];
    expect(selectSupersededJobs(waiting, job('a1', 'project-a', 500))).toEqual([]);
  });
});
