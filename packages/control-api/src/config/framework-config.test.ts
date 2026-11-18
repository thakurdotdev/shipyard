import { describe, expect, it } from 'bun:test';
import { servesStaticFiles } from './framework-config';

describe('servesStaticFiles', () => {
  it('is always true for Vite', () => {
    expect(servesStaticFiles({ app_type: 'vite' })).toBe(true);
    expect(servesStaticFiles({ app_type: 'vite', serving_mode: 'process' })).toBe(true);
  });

  it('follows the last deploy for Next.js', () => {
    expect(servesStaticFiles({ app_type: 'nextjs', serving_mode: null })).toBe(false);
    expect(servesStaticFiles({ app_type: 'nextjs', serving_mode: 'process' })).toBe(false);
    expect(servesStaticFiles({ app_type: 'nextjs', serving_mode: 'static' })).toBe(true);
  });

  it('is false for servers', () => {
    expect(servesStaticFiles({ app_type: 'express' })).toBe(false);
  });
});
