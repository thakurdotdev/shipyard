import { describe, expect, it } from 'bun:test';

// The service module opens a (lazy) DB client on import; these tests never query it.
process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
const { GateError, GateService } = await import('./gate-service');

describe('GateService.initialAccessRow', () => {
  it('hashes the password and enables protection', async () => {
    const row = await GateService.initialAccessRow('correct horse', 24);
    expect(row.enabled).toBe(true);
    expect(row.session_hours).toBe(24);
    expect(row.password_hash).toStartWith('$argon2id$');
    expect(await Bun.password.verify('correct horse', row.password_hash)).toBe(true);
  });

  it('defaults the session to a week', async () => {
    expect((await GateService.initialAccessRow('long-enough')).session_hours).toBe(168);
  });

  it('rejects short passwords before anything is created', async () => {
    await expect(GateService.initialAccessRow('short')).rejects.toBeInstanceOf(GateError);
    await expect(GateService.initialAccessRow('long-enough', 0)).rejects.toThrow('Session length');
  });
});
