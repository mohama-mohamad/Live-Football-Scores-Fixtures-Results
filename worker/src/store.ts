// طبقة التخزين فوق D1: ذاكرة مؤقتة للردود + عدّاد الطلبات اليومي
import type { Env } from './env';

export class BudgetExceededError extends Error {
  constructor() {
    super('تم استهلاك الحد اليومي لطلبات مزوّد البيانات');
  }
}

export interface Cached<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export async function usageToday(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT count FROM usage WHERE day = ?').bind(utcDay()).first<{ count: number }>();
  return row?.count ?? 0;
}

export function dailyLimit(env: Env): number {
  return Number(env.DAILY_REQUEST_LIMIT) || 100;
}

// يحجز طلباً واحداً من الحد اليومي أو يرمي BudgetExceededError
export async function consumeBudget(env: Env): Promise<void> {
  const limit = dailyLimit(env);
  const row = await env.DB.prepare(
    `INSERT INTO usage (day, count) VALUES (?1, 1)
     ON CONFLICT(day) DO UPDATE SET count = count + 1 WHERE count < ?2
     RETURNING count`,
  )
    .bind(utcDay(), limit)
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
): Promise<Cached<T>> {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT value, fetched_at, expires_at FROM cache WHERE key = ?')
    .bind(key)
    .first<{ value: string; fetched_at: number; expires_at: number }>();
  if (row && row.expires_at > now) return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at, stale: false };

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

export async function cleanup(env: Env, now = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM cache WHERE expires_at < ?').bind(now - 7 * 86_400_000),
    env.DB.prepare('DELETE FROM match_state WHERE kickoff < ?').bind(now - 3 * 86_400_000),
    env.DB.prepare('DELETE FROM usage WHERE day < ?').bind(utcDay(now - 30 * 86_400_000)),
  ]);
}
