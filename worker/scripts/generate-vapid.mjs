// يولّد مفاتيح VAPID لتنبيهات Web Push
// الاستخدام: npm run vapid            ← يطبع المفاتيح
//            npm run vapid -- --dev   ← يكتبها أيضاً في .dev.vars للتشغيل المحلي
import { createECDH } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const pub = b64url(ecdh.getPublicKey());
const priv = b64url(ecdh.getPrivateKey());

console.log('VAPID_PUBLIC_KEY=' + pub);
console.log('VAPID_PRIVATE_KEY=' + priv);
console.log('\nللنشر على Cloudflare:');
console.log('  npx wrangler secret put VAPID_PUBLIC_KEY');
console.log('  npx wrangler secret put VAPID_PRIVATE_KEY');

if (process.argv.includes('--dev')) {
  const file = new URL('../.dev.vars', import.meta.url);
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  text = text.replace(/^VAPID_(PUBLIC|PRIVATE)_KEY=.*\n?/gm, '');
  text += `VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${priv}\n`;
  writeFileSync(file, text);
  console.log('\nتمت الكتابة في worker/.dev.vars');
}
