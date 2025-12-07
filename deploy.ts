import { Elysia } from 'elysia';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';

const SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

function verify(body: string, sig?: string | null) {
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

new Elysia()
  .post('/webhook/deploy', async ({ request }) => {
    const body = await request.text();
    const sig = request.headers.get('x-hub-signature-256');

    if (!verify(body, sig)) {
      return new Response('Invalid signature', { status: 401 });
    }

    exec(`bash /opt/platform/deploy-project/deploy.sh`, (err, stdout, stderr) => {
      if (err) console.error('Deploy error:', err);
      console.log(stdout);
      console.error(stderr);
    });

    return { ok: true };
  })
  .listen(5050);
