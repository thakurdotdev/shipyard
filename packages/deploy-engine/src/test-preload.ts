/**
 * Loaded before every test file (bunfig.toml `[test] preload`).
 *
 * Tests share one process, and modules such as config/paths.ts read their environment
 * once at import, so isolation has to be in place before the first import:
 *
 * - BASE_DIR: builds and deployments go to a throwaway folder, never the machine's
 *   real apps directory.
 * - NGINX_SITE_GUARD: generated sites include nothing from /etc/nginx/snippets. A
 *   server's own guard rules may use variables (such as $from_cloudflare) that the
 *   tests' private Nginx does not define, which stops it from starting.
 */
import { afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const baseDir = mkdtempSync(join(tmpdir(), 'shipyard-test-apps-'));
process.env.BASE_DIR = baseDir;
process.env.NGINX_SITE_GUARD = '/nonexistent/shipyard-test-site-guard/*.conf';

afterAll(() => rmSync(baseDir, { recursive: true, force: true }));
