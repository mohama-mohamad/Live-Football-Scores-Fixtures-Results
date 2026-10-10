// نقطة الدخول: واجهة /api + مهمة التنبيهات الدورية (Cron)
// الملفات الثابتة للتطبيق تُخدم تلقائياً من مجلد app/dist (انظر wrangler.jsonc)
import type { NotificationEvents, PushPrefs } from '../../shared/types';
import { LEAGUES } from '../../shared/leagues';
import type { Env } from './env';
import { BudgetExceededError, cleanup } from './store';
import { ProviderError } from './providers/types';
import { isValidTimeZone } from './time';
import { b64urlDecode, isAllowedEndpoint, sendPush } from './push/webpush';
import * as svc from './service';

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  });
}

function envelope<T>(r: { data: T; stale: boolean; provider: string }, cache = 'no-store') {
  return json({ data: r.data, stale: r.stale || undefined, provider: r.provider, updatedAt: new Date().toISOString() }, 200, cache);
}

const EVENT_KEYS: (keyof NotificationEvents)[] = ['kickoff', 'goal', 'redCard', 'halftime', 'fulltime'];

function sanitizePrefs(raw: unknown): PushPrefs {
  const r = (raw ?? {}) as Partial<PushPrefs>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 300) : []);
  const ev = (r.events ?? {}) as Partial<NotificationEvents>;
  const events = Object.fromEntries(EVENT_KEYS.map((k) => [k, ev[k] !== false])) as unknown as NotificationEvents;
  return { teams: ids(r.teams), leagues: ids(r.leagues), events };
}

function parseSubscription(raw: unknown): { endpoint: string; p256dh: string; auth: string } {
  const s = (raw ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = String(s.endpoint ?? '');
  const p256dh = String(s.keys?.p256dh ?? '');
  const auth = String(s.keys?.auth ?? '');
  if (!isAllowedEndpoint(endpoint) || endpoint.length > 1024) throw new HttpError(400, 'عنوان الاشتراك غير مدعوم');
  try {
    if (b64urlDecode(p256dh).length !== 65 || b64urlDecode(auth).length < 16) throw new Error();
  } catch {
    throw new HttpError(400, 'مفاتيح الاشتراك غير صالحة');
  }
  return { endpoint, p256dh, auth };
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length') ?? 0) > 16_384) throw new HttpError(413, 'الطلب كبير جداً');
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON غير صالح');
  }
}

async function handleApi(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method;
  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/api/meta') {
    const budget = await svc.budgetInfo(env);
    return json({ provider: svc.getProvider(env).name, leagues: LEAGUES, vapidPublicKey: (await svc.vapidKeys(env)).publicKey, ...budget }, 200, 'max-age=60');
  }

  if (method === 'GET' && path === '/api/matches') {
    const date = url.searchParams.get('date') ?? '';
    const tz = url.searchParams.get('tz') || 'UTC';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, 'تاريخ غير صالح');
    if (!isValidTimeZone(tz)) throw new HttpError(400, 'منطقة زمنية غير صالحة');
    return envelope(await svc.matchesForLocalDate(env, date, tz), 'max-age=15');
  }

  if (method === 'GET' && path === '/api/live') return envelope(await svc.liveMatches(env, ctx));

  if (method === 'GET' && (m = path.match(/^\/api\/match\/(\d+)$/))) {
    const r = await svc.matchDetails(env, Number(m[1]));
    if (!r.data) throw new HttpError(404, 'المباراة غير موجودة');
    return envelope(r, 'max-age=10');
  }

  if (method === 'GET' && (m = path.match(/^\/api\/standings\/(\d+)$/))) {
    const r = await svc.standings(env, Number(m[1]));
    if (!r.data) throw new HttpError(404, 'لا يوجد جدول ترتيب لهذه البطولة');
    return envelope(r, 'max-age=60');
  }

  if (method === 'GET' && (m = path.match(/^\/api\/league\/(\d+)\/matches$/))) return envelope(await svc.leagueMatches(env, Number(m[1])), 'max-age=60');

  // ---------- التنبيهات ----------
  if (method === 'POST' && path === '/api/push/subscribe') {
    const body = await readJson(req);
    const sub = parseSubscription(body.subscription);
    const prefs = sanitizePrefs(body.prefs);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO subscriptions (endpoint, p256dh, auth, prefs, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, prefs = excluded.prefs, updated_at = excluded.updated_at`,
    )
      .bind(sub.endpoint, sub.p256dh, sub.auth, JSON.stringify(prefs), now)
      .run();
    return json({ ok: true, prefs });
  }

  if (method === 'POST' && path === '/api/push/unsubscribe') {
    const body = await readJson(req);
    await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(String(body.endpoint ?? '')).run();
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/api/push/test') {
    const keys = await svc.vapidKeys(env);
    const body = await readJson(req);
    const sub = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM subscriptions WHERE endpoint = ?')
      .bind(String(body.endpoint ?? ''))
      .first<{ endpoint: string; p256dh: string; auth: string }>();
    if (!sub) throw new HttpError(404, 'الاشتراك غير موجود، فعّل التنبيهات أولاً');
    const r = await sendPush(sub, { title: '✅ التنبيهات تعمل', body: 'ستصلك تنبيهات الأهداف ونتائج فرقك المفضلة هنا', tag: 'test', url: '/' }, keys, { ttl: 300 });
    if (r.gone) await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
    return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502);
  }

  throw new HttpError(404, 'غير موجود');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await handleApi(req, env, ctx, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof BudgetExceededError) return json({ error: e.message }, 429);
      if (e instanceof ProviderError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'حدث خطأ في الخادم' }, 500);
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const res = await svc.refreshLive(env);
    if (res.notices.length) {
      const stats = await svc.dispatch(env, res.notices);
      console.log('notices', res.notices.length, stats);
    }
    // تنظيف البيانات القديمة مرة كل ساعة تقريباً
    if (new Date().getUTCMinutes() === 7) ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;
