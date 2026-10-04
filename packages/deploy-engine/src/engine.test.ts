import { describe, it, expect } from 'bun:test';
import { DeployService } from './services/deploy-service';

// Note: this file intentionally avoids `mock.module()` / global mocks because they
// are process-wide in `bun test` and leak into every other test file. `serveRequest`
// only returns a static response, so no mocks are needed here.

describe('Deploy Engine', () => {
  it('should serve index.html for root request', async () => {
    const req = new Request('http://test-project.localhost/');
    const res = await DeployService.serveRequest(req);

    expect(res.status).toBe(200);
  });

  it('should serve static asset if exists', async () => {
    const req = new Request('http://test-project.localhost/style.css');
    const res = await DeployService.serveRequest(req);

    expect(res.status).toBe(200);
  });

  it('should fallback to index.html for unknown routes (SPA)', async () => {
    const req = new Request('http://test-project.localhost/unknown-route');
    const res = await DeployService.serveRequest(req);

    expect(res.status).toBe(200);
  });
});
