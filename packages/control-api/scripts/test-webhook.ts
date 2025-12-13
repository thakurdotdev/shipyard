import { createHmac } from 'crypto';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || 'test-secret';
const API_URL = 'http://localhost:4000/github/webhook';

// Payload for 'push' event
const payload = {
  ref: 'refs/heads/main',
  repository: {
    id: 123456,
    full_name: 'test-owner/test-repo',
    name: 'test-repo',
    owner: {
      login: 'test-owner',
    },
  },
  installation: {
    id: 999,
  },
  pusher: {
    name: 'test-user',
  },
};

const payloadString = JSON.stringify(payload);
const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(payloadString).digest('hex')}`;

console.log('Sending webhook to:', API_URL);
console.log('Signature:', signature);

async function sendWebhook() {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature,
        'x-github-event': 'push',
      },
      body: payloadString,
    });

    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response:', text);
  } catch (e) {
    console.error('Failed to send webhook:', e);
  }
}

sendWebhook();
