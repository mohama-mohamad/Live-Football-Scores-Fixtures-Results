import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/relay';

describe('relay signature', () => {
  const body = '{"ts":1,"live":[]}\n';
  // نفس ما تنتجه مهمة GitHub: openssl dgst -sha256 -hmac KEY -hex
  const sig = createHmac('sha256', 'secret-key').update(body).digest('hex');

  it('accepts a valid HMAC', async () => {
    expect(await verifySignature('secret-key', body, sig)).toBe(true);
  });
  it('rejects a wrong key, a tampered body or a malformed signature', async () => {
    expect(await verifySignature('other', body, sig)).toBe(false);
    expect(await verifySignature('secret-key', body + ' ', sig)).toBe(false);
    expect(await verifySignature('secret-key', body, 'xyz')).toBe(false);
  });
});
