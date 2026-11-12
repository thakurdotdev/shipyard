import { describe, expect, it } from 'bun:test';
import { SecurityService } from './security-service';

describe('SecurityService.validatePreDeployCommand', () => {
  it('accepts empty values and common migration commands', () => {
    for (const cmd of [
      null,
      undefined,
      '  ',
      'bun run db:migrate',
      'bunx drizzle-kit migrate',
      'npx prisma migrate deploy && bun run seed',
      'go run ./cmd/migrate',
    ]) {
      expect(SecurityService.validatePreDeployCommand(cmd)).toBe(true);
    }
  });

  it('rejects shell tricks and unknown programs', () => {
    expect(() => SecurityService.validatePreDeployCommand('bun run migrate; rm -rf /')).toThrow();
    expect(() => SecurityService.validatePreDeployCommand('psql < dump.sql')).toThrow();
    expect(() => SecurityService.validatePreDeployCommand('python manage.py migrate')).toThrow(
      'must start with',
    );
  });

  it('keeps build commands restricted to package managers', () => {
    expect(() => SecurityService.validateBuildCommand('npx prisma generate')).toThrow();
  });
});
