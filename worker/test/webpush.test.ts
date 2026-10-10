import { describe, it, expect } from 'vitest';
import { createECDH, createPublicKey, verify, randomBytes } from 'node:crypto';
// @ts-expect-error لا توجد تعريفات أنواع لهذه المكتبة
import ece from 'http_ece';
import { encryptPayload, vapidAuthorization, b64urlEncode, b64urlDecode, isAllowedEndpoint, sendPush } from '../src/push/webpush';

function makeVapid() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64urlEncode(ecdh.getPublicKey()),
    privateKey: b64urlEncode(ecdh.getPrivateKey()),
    subject: 'mailto:test@example.com',
  };
}

describe('aes128gcm encryption', () => {
  it('is decryptable by the reference http_ece implementation', async () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = randomBytes(16);
    const target = { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) };
    const message = JSON.stringify({ title: '⚽ هدف للهلال!', body: 'الهلال 1 - 0 النصر' });

    const encrypted = await encryptPayload(target, new TextEncoder().encode(message));
    const decrypted = ece.decrypt(Buffer.from(encrypted), {
      version: 'aes128gcm',
      privateKey: ua,
      authSecret: auth,
    });
    expect(decrypted.toString('utf8')).toBe(message);
  });
});

describe('VAPID', () => {
  it('produces a valid ES256 JWT for the endpoint origin', async () => {
    const keys = makeVapid();
    const header = await vapidAuthorization('https://web.push.apple.com/abc/def', keys, 1_700_000_000);
    const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(m).not.toBeNull();
    const [jwt, k] = [m![1], m![2]];
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(b64urlDecode(c)).toString());
    expect(claims).toEqual({ aud: 'https://web.push.apple.com', exp: 1_700_000_000 + 43200, sub: 'mailto:test@example.com' });

    const pub = b64urlDecode(keys.publicKey);
    const key = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)) },
      format: 'jwk',
    });
    const ok = verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64urlDecode(s)));
    expect(ok).toBe(true);
  });
});

describe('endpoint allowlist', () => {
  it('accepts known push services and rejects others', () => {
    expect(isAllowedEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedEndpoint('https://evil.example.com/push.apple.com')).toBe(false);
    expect(isAllowedEndpoint('http://web.push.apple.com/x')).toBe(false);
    expect(isAllowedEndpoint('not a url')).toBe(false);
  });
});

describe('sendPush', () => {
  it('posts encrypted body with the right headers and flags gone subscriptions', async () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const target = { endpoint: 'https://web.push.apple.com/x', p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(randomBytes(16)) };
    let seen: RequestInit | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response('', { status: 410 });
    }) as unknown as typeof fetch;
    const res = await sendPush(target, { title: 't', body: 'b' }, makeVapid(), { topic: 'match-1' }, fakeFetch);
    expect(res.gone).toBe(true);
    const h = seen!.headers as Record<string, string>;
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.Authorization).toMatch(/^vapid t=/);
    expect(h.Topic).toBe('match-1');
  });
});
