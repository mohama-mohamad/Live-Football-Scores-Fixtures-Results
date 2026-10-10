// تنفيذ Web Push باستخدام WebCrypto فقط (يعمل داخل Cloudflare Workers):
// - توقيع VAPID (RFC 8292) بخوارزمية ES256
// - تشفير المحتوى aes128gcm (RFC 8188 + RFC 8291)

export interface PushTarget {
  endpoint: string;
  p256dh: string; // المفتاح العام للمتصفح (base64url)
  auth: string; // سرّ المصادقة (base64url)
}

export interface VapidKeys {
  publicKey: string; // نقطة P-256 غير مضغوطة 65 بايت (base64url)
  privateKey: string; // القيمة d بطول 32 بايت (base64url)
  subject: string; // mailto: أو https:
}

export interface PushOptions {
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  topic?: string;
}

const enc = new TextEncoder();

export function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// ---------- VAPID ----------

async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be an uncompressed P-256 point');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: keys.privateKey,
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: keys.subject })));
  const unsigned = `${header}.${claims}`;
  const key = await importVapidPrivateKey(keys);
  // WebCrypto يعيد التوقيع بصيغة r||s (64 بايت) وهي الصيغة المطلوبة في JWT
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

// يولّد زوج مفاتيح VAPID جديداً (P-256)
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const pub = concat(new Uint8Array([4]), b64urlDecode(jwk.x!), b64urlDecode(jwk.y!));
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d! };
}

// ---------- التشفير aes128gcm ----------

export async function encryptPayload(
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  plaintext: Uint8Array,
  // للاختبارات فقط: تثبيت المفتاح المؤقت والملح
  fixed?: { localKeys?: CryptoKeyPair; salt?: Uint8Array },
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  if (uaPublic.length !== 65) throw new Error('invalid p256dh');
  if (authSecret.length < 16) throw new Error('invalid auth secret');

  const local =
    fixed?.localKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256),
  );

  // RFC 8291 §3.4
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // سجل واحد فقط: المحتوى + محدِّد السجل الأخير 0x02
  const record = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  const rs = 4096;
  if (record.length + 16 > rs) throw new Error('payload too large');
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

// خوادم التنبيهات المسموح بها فقط (لمنع إرسال طلبات إلى عناوين عشوائية)
const ALLOWED_PUSH_HOSTS = [
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && ALLOWED_PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export interface PushResult {
  ok: boolean;
  status: number;
  gone: boolean; // الاشتراك لم يعد صالحاً ويجب حذفه
  body?: string;
}

export async function sendPush(
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  opts: PushOptions = {},
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<PushResult> {
  const body = await encryptPayload(target, enc.encode(JSON.stringify(payload)));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(target.endpoint, keys),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 3600),
    Urgency: opts.urgency ?? 'high',
  };
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const res = await fetcher(target.endpoint, { method: 'POST', headers, body });
  const text = res.ok ? undefined : (await res.text()).slice(0, 300);
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, body: text };
}
