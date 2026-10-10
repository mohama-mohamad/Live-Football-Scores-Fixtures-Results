// طبقة التخزين فوق D1: ذاكرة مؤقتة للردود + عدّاد الطلبات اليومي
import type { Env } from './env';

export class BudgetExceededError extends Error {
  constructor() {
    super('تم استهلاك الحد اليومي لطلبات مزوّد البيانات');
  }
}

// طلب فشل مؤخراً: لا نعيد المحاولة فوراً حتى لا يُستهلك الرصيد في حلقة
export class RetryLaterError extends Error {
  constructor() {
    super('جارٍ تحديث البيانات، حاول بعد قليل');
  }
}

export interface Cached<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export async function usageToday(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM usage WHERE day LIKE ? || '%'").bind(utcDay()).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function usageFor(env: Env, purpose: BudgetPurpose): Promise<number> {
  const row = await env.DB.prepare('SELECT count FROM usage WHERE day = ?').bind(`${utcDay()}:${purpose}`).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function setMeta(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

// تقسيم الحد اليومي: 60% للمتابعة المباشرة والتنبيهات، و40% لتصفح التطبيق
// حتى لا يستطيع أحد استهلاك رصيد التنبيهات بطلبات عشوائية من التطبيق
export type BudgetPurpose = 'live' | 'browse';
export function budgetCap(env: Env, purpose: BudgetPurpose): number {
  const limit = dailyLimit(env);
  const live = Math.ceil(limit * 0.6);
  return purpose === 'live' ? live : limit - live;
}

export function dailyLimit(env: Env): number {
  return Number(env.DAILY_REQUEST_LIMIT) || 100;
}

// يحجز طلباً واحداً من حصة الغرض المحدد أو يرمي BudgetExceededError
export async function consumeBudget(env: Env, purpose: BudgetPurpose): Promise<void> {
  const limit = budgetCap(env, purpose);
  const row = await env.DB.prepare(
    `INSERT INTO usage (day, count) VALUES (?1, 1)
     ON CONFLICT(day) DO UPDATE SET count = count + 1 WHERE count < ?2
     RETURNING count`,
  )
    .bind(`${utcDay()}:${purpose}`, limit)
    .first<{ count: number }>();
  if (!row) throw new BudgetExceededError();
}

// منع تكرار نفس الطلب في نفس اللحظة داخل نفس النسخة
const inflight = new Map<string, Promise<unknown>>();

// ttlSec يمكن أن يكون دالة تحسب مدة الصلاحية حسب القيمة (مثلاً: مباراة جارية = مدة أقصر)
export async function cached<T>(
  env: Env,
  key: string,
  ttlSec: number | ((value: T) => number),
  load: () => Promise<T>,
  // أقل مدة بين محاولتين لجلب نفس المفتاح (تُسجَّل المحاولة قبل الطلب، فتحمي حتى لو انقطعت المعالجة)
  minRetrySec = 0,
): Promise<Cached<T>> {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT value, fetched_at, expires_at FROM cache WHERE key = ?')
    .bind(key)
    .first<{ value: string; fetched_at: number; expires_at: number }>();
  if (row && row.expires_at > now) return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at, stale: false };

  if (minRetrySec > 0 && !inflight.has(key) && !(await claimInterval(env, `attempt:${key}`, minRetrySec * 1000, now))) {
    if (row) return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at, stale: true };
    throw new RetryLaterError();
  }

  try {
    let p = inflight.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      inflight.set(key, p);
    }
    const value = await p.finally(() => inflight.delete(key));
    await env.DB.prepare(
      `INSERT INTO cache (key, value, fetched_at, expires_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    )
      .bind(key, JSON.stringify(value), now, now + (typeof ttlSec === 'function' ? ttlSec(value) : ttlSec) * 1000)
      .run();
    return { value, fetchedAt: now, stale: false };
  } catch (err) {
    // عند الفشل أو انتهاء الحد: نعيد آخر نسخة محفوظة إن وُجدت
    if (row) return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at, stale: true };
    throw err;
  }
}

export async function getMeta(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

// يحجز "قفل" زمني: ينجح فقط إن مرّ intervalMs منذ آخر حجز (آمن ضد التزامن)
export async function claimInterval(env: Env, key: string, intervalMs: number, now = Date.now()): Promise<boolean> {
  const row = await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(meta.value AS INTEGER) <= ?3
     RETURNING value`,
  )
    .bind(key, String(now), now - intervalMs)
    .first();
  return !!row;
}

// حدّ بسيط لعدد الطلبات لكل مفتاح (مثل عنوان IP) خلال نافذة زمنية
export async function rateLimit(env: Env, bucket: string, limit: number, windowSec: number, now = Date.now()): Promise<boolean> {
  const start = Math.floor(now / 1000 / windowSec) * windowSec;
  const row = await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?1, '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(meta.value AS INTEGER) + 1 AS TEXT)
     RETURNING CAST(value AS INTEGER) AS n`,
  )
    .bind(`rl:${start}:${bucket}`)
    .first<{ n: number }>();
  return (row?.n ?? 0) <= limit;
}

export async function cleanup(env: Env, now = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM meta WHERE key LIKE 'rl:%' AND CAST(substr(key, 4, 10) AS INTEGER) < ?").bind(Math.floor(now / 1000) - 86400),
    env.DB.prepare("DELETE FROM meta WHERE key LIKE 'attempt:%' AND CAST(value AS INTEGER) < ?").bind(now - 86_400_000),
    env.DB.prepare('DELETE FROM cache WHERE expires_at < ?').bind(now - 7 * 86_400_000),
    env.DB.prepare('DELETE FROM match_state WHERE kickoff < ?').bind(now - 3 * 86_400_000),
    env.DB.prepare('DELETE FROM usage WHERE day < ?').bind(utcDay(now - 30 * 86_400_000)),
  ]);
}
