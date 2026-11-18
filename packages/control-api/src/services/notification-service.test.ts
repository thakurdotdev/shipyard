import { describe, expect, it } from 'bun:test';
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'crypto';
import webpush from 'web-push';

import { NOTIFICATION_EVENTS, describeDevice, resolvePreferences } from './notification-events';

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** Decrypts an aes128gcm Web Push body the way a browser does (RFC 8291 / RFC 8188). */
function decryptPush(body: Buffer, uaPrivate: ReturnType<typeof createECDH>, authSecret: Buffer) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const asPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const uaPublic = uaPrivate.getPublicKey();
  const ecdhSecret = uaPrivate.computeSecret(asPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublic,
    asPublic,
    Buffer.from([1]),
  ]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString('utf8');
}

describe('Web Push encryption under Bun', () => {
  it('produces a request a browser can decrypt', () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const authSecret = randomBytes(16);
    const vapid = webpush.generateVAPIDKeys();
    const payload = JSON.stringify({ title: '✅ portfolio is live', url: '/projects/x' });

    const request = webpush.generateRequestDetails(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: {
          p256dh: browser.getPublicKey().toString('base64url'),
          auth: authSecret.toString('base64url'),
        },
      },
      payload,
      {
        TTL: 60,
        urgency: 'high',
        vapidDetails: {
          subject: 'https://deploy.example.com',
          publicKey: vapid.publicKey,
          privateKey: vapid.privateKey,
        },
      },
    );

    expect(request.headers['Content-Encoding']).toBe('aes128gcm');
    expect(String(request.headers.Authorization)).toStartWith('vapid t=');
    expect(request.headers.Urgency).toBe('high');
    expect(decryptPush(request.body as Buffer, browser, authSecret)).toBe(payload);
  });
});

describe('notification preferences', () => {
  it('falls back to the defaults for anything not saved', () => {
    const prefs = resolvePreferences(null);
    expect(prefs.events.deploy_failed).toEqual({ push: true, email: true });
    expect(prefs.events.deploy_started).toEqual({ push: false, email: false });
    expect(prefs.muted_projects).toEqual([]);
    expect(Object.keys(prefs.events).sort()).toEqual(Object.keys(NOTIFICATION_EVENTS).sort());
  });

  it('keeps saved choices, ignores junk and unknown events', () => {
    const prefs = resolvePreferences({
      events: JSON.stringify({
        deploy_failed: { push: false, email: 'yes' },
        nope: { push: true },
      }),
      muted_projects: JSON.stringify(['p1', 7, 'p2']),
    });
    expect(prefs.events.deploy_failed).toEqual({ push: false, email: true });
    expect('nope' in prefs.events).toBe(false);
    expect(prefs.muted_projects).toEqual(['p1', 'p2']);
    expect(resolvePreferences({ events: '{bad', muted_projects: 'x' }).muted_projects).toEqual([]);
  });

  it('names devices from their user agent', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android');
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone');
    expect(describeDevice(undefined)).toBe('Browser on Unknown device');
  });
});
