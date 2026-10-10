// منطق التطبيق: جلب البيانات مع الذاكرة المؤقتة، وتحديث المباريات المباشرة، وإرسال التنبيهات
import type { Match, MatchDetails, PushPrefs, Standings } from '../../shared/types';
import { leaguePriority } from '../../shared/leagues';
import type { Env } from './env';
import { ApiFootballProvider } from './providers/apiFootball';
import { MockProvider } from './providers/mock';
import type { Provider } from './providers/types';
import { cached, claimInterval, consumeBudget, dailyLimit, usageToday } from './store';
import { DAY_MS, localDayRange, utcDate, utcDatesCovering } from './time';
import { diffMatch, type Notice } from './notify';
import { sendPush, type VapidKeys } from './push/webpush';

export function getProvider(env: Env): Provider {
  if (env.PROVIDER === 'api-football') {
    if (!env.API_FOOTBALL_KEY) throw new Error('API_FOOTBALL_KEY غير مضبوط');
    return new ApiFootballProvider(env.API_FOOTBALL_KEY, {
      onRequest: () => consumeBudget(env),
      memo: async (key, ttl, fn) => (await cached(env, key, ttl, fn)).value,
    });
  }
  return new MockProvider();
}

const inPlay = (m: Match) => m.status === 'live' || m.status === 'halftime' || m.status === 'penalties';

export function pollIntervalMs(env: Env, p: Provider): number {
  const sec = Number(env.LIVE_POLL_SECONDS) || 60;
  return (p.limited ? Math.max(30, sec) : Math.min(sec, 20)) * 1000;
}

function sortMatches(list: Match[]): Match[] {
  return list.sort(
    (a, b) => leaguePriority(a.league.id) - leaguePriority(b.league.id) || a.league.id - b.league.id || a.kickoff.localeCompare(b.kickoff) || a.id - b.id,
  );
}

// مدة صلاحية قائمة مباريات يوم UTC (بالثواني)
function dateTtl(p: Provider, date: string, now: number): number {
  if (!p.limited) return 15;
  const diffDays = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${utcDate(now)}T00:00:00Z`)) / DAY_MS);
  if (diffDays < -1) return 7 * 86400;
  if (diffDays === -1) return 3 * 3600;
  if (diffDays === 0) return 30 * 60;
  return 3 * 3600;
}

async function utcDayMatches(env: Env, p: Provider, date: string, now = Date.now()) {
  return cached(env, `date:${date}`, dateTtl(p, date, now), () => p.matchesByUtcDate(date));
}

interface StateRow {
  id: number;
  status: string;
  snapshot: string;
  updated_at: number;
}

async function loadStates(env: Env, ids: number[]): Promise<Map<number, { match: Match; updatedAt: number }>> {
  const out = new Map<number, { match: Match; updatedAt: number }>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT id, status, snapshot, updated_at FROM match_state WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<StateRow>();
    for (const r of results) out.set(r.id, { match: JSON.parse(r.snapshot), updatedAt: r.updated_at });
  }
  return out;
}

// مباريات يوم محلي، مع دمج آخر حالة مباشرة معروفة
export async function matchesForLocalDate(env: Env, date: string, tz: string) {
  const p = getProvider(env);
  const [start, end] = localDayRange(date, tz);
  const days = await Promise.all(utcDatesCovering(start, end).map((d) => utcDayMatches(env, p, d)));
  let stale = false;
  const byId = new Map<number, { match: Match; fetchedAt: number }>();
  for (const d of days) {
    stale ||= d.stale;
    for (const m of d.value) {
      const t = Date.parse(m.kickoff);
      if (t >= start && t < end) byId.set(m.id, { match: m, fetchedAt: d.fetchedAt });
    }
  }
  if (p.limited && byId.size) {
    const states = await loadStates(env, [...byId.keys()]);
    for (const [id, s] of states) {
      const cur = byId.get(id)!;
      if (s.updatedAt > cur.fetchedAt) byId.set(id, { match: s.match, fetchedAt: s.updatedAt });
    }
  }
  return { data: sortMatches([...byId.values()].map((v) => v.match)), stale, provider: p.name };
}

export async function liveMatches(env: Env, ctx?: ExecutionContext) {
  const p = getProvider(env);
  const res = await refreshLive(env, p);
  if (ctx && res.notices.length) ctx.waitUntil(dispatch(env, res.notices));
  const since = Date.now() - 4 * 3600_000;
  const { results } = await env.DB.prepare(`SELECT snapshot, updated_at FROM match_state WHERE status IN ('live','halftime','penalties') AND updated_at > ?`)
    .bind(since)
    .all<{ snapshot: string; updated_at: number }>();
  const lastUpdate = Math.max(0, ...results.map((r) => r.updated_at));
  const stale = results.length > 0 && Date.now() - lastUpdate > pollIntervalMs(env, p) * 3 + 60_000;
  return { data: sortMatches(results.map((r) => JSON.parse(r.snapshot) as Match)), stale, provider: p.name };
}

export async function matchDetails(env: Env, id: number) {
  const p = getProvider(env);
  const r = await cached<MatchDetails | null>(
    env,
    `match:${id}`,
    (m) => {
      if (!p.limited) return 10;
      if (!m) return 600;
      if (inPlay(m)) return Math.max(60, pollIntervalMs(env, p) / 1000);
      if (m.status === 'finished') return 86400;
      const untilKickoff = Date.parse(m.kickoff) - Date.now();
      return untilKickoff < 2 * 3600_000 ? 600 : 3 * 3600;
    },
    () => p.match(id),
  );
  let data = r.value;
  // المباراة الجارية: نستخدم أحدث نتيجة وأحداث من المتابعة المباشرة
  if (data && p.limited) {
    const s = (await loadStates(env, [id])).get(id);
    if (s && s.updatedAt > r.fetchedAt) data = { ...data, ...s.match, stats: data.stats, lineups: data.lineups };
  }
  return { data, stale: r.stale, provider: p.name };
}

export async function standings(env: Env, leagueId: number) {
  const p = getProvider(env);
  const r = await cached<Standings | null>(env, `standings:${leagueId}`, p.limited ? 6 * 3600 : 60, () => p.standings(leagueId));
  return { data: r.value, stale: r.stale, provider: p.name };
}

export async function leagueMatches(env: Env, leagueId: number) {
  const p = getProvider(env);
  const r = await cached(env, `league:${leagueId}`, p.limited ? 3 * 3600 : 30, () => p.leagueMatches(leagueId));
  return { data: r.value, stale: r.stale, provider: p.name };
}

export async function budgetInfo(env: Env) {
  const p = getProvider(env);
  return { limited: p.limited, used: p.limited ? await usageToday(env) : 0, limit: p.limited ? dailyLimit(env) : null, pollSeconds: pollIntervalMs(env, p) / 1000 };
}

// ---------- المتابعة المباشرة ----------

export interface RefreshResult {
  polled: boolean;
  reason?: string;
  notices: Notice[];
}

// عدد الطلبات المحجوزة للتصفح داخل التطبيق (لا تستهلكها المتابعة المباشرة)
const RESERVE_FOR_BROWSING = 15;

export async function refreshLive(env: Env, p: Provider = getProvider(env), now = Date.now()): Promise<RefreshResult> {
  if (!(await claimInterval(env, 'live_poll', pollIntervalMs(env, p) - 2000, now))) return { polled: false, reason: 'interval', notices: [] };

  // المباريات التي كانت جارية في آخر فحص
  const { results: openRows } = await env.DB.prepare(`SELECT id, snapshot FROM match_state WHERE status IN ('live','halftime','penalties')`).all<{
    id: number;
    snapshot: string;
  }>();

  // جدول اليوم وأمس (لمعرفة المباريات التي يُفترض أن تبدأ الآن)
  let schedule: Match[] = [];
  try {
    const days = await Promise.all([utcDate(now - DAY_MS), utcDate(now)].map((d) => utcDayMatches(env, p, d, now)));
    schedule = days.flatMap((d) => d.value);
  } catch (e) {
    console.warn('schedule load failed', e);
  }
  const soon = schedule.filter((m) => {
    const t = Date.parse(m.kickoff);
    return m.status === 'scheduled' && t <= now + 2 * 60_000 && t > now - 3 * 3600_000;
  });

  // نزرع حالة "لم تبدأ" للمباريات القريبة حتى نكتشف لحظة انطلاقها
  if (soon.length) {
    await env.DB.batch(
      soon.map((m) =>
        env.DB.prepare('INSERT OR IGNORE INTO match_state (id, status, kickoff, snapshot, updated_at) VALUES (?, ?, ?, ?, ?)').bind(
          m.id,
          m.status,
          Date.parse(m.kickoff),
          JSON.stringify(m),
          0,
        ),
      ),
    );
  }

  const shouldPoll = !p.limited || openRows.length > 0 || soon.length > 0 || schedule.some(inPlay);
  if (!shouldPoll) return { polled: false, reason: 'no-matches', notices: [] };
  if (p.limited && dailyLimit(env) - (await usageToday(env)) <= RESERVE_FOR_BROWSING) {
    return { polled: false, reason: 'budget', notices: [] };
  }

  const live = await p.live();
  const liveIds = new Set(live.map((m) => m.id));
  const gone = openRows.map((r) => r.id).filter((id) => !liveIds.has(id));
  const finals = gone.length ? await p.matchesByIds(gone) : [];
  const updates = [...live, ...finals];

  const prevStates = await loadStates(env, updates.map((m) => m.id));
  const notices: Notice[] = [];
  const writes: D1PreparedStatement[] = [];
  for (const m of updates) {
    const prev = prevStates.get(m.id)?.match;
    notices.push(...diffMatch(prev, m));
    const snap = JSON.stringify(m);
    writes.push(
      env.DB.prepare(
        `INSERT INTO match_state (id, status, kickoff, snapshot, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
      ).bind(m.id, m.status, Date.parse(m.kickoff), snap, now),
    );
  }
  if (writes.length) await env.DB.batch(writes);
  return { polled: true, notices };
}

// ---------- إرسال التنبيهات ----------

export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  prefs: string;
}

export function wants(prefs: PushPrefs, n: Notice): boolean {
  if (!prefs.events?.[n.kind]) return false;
  const m = n.match;
  return prefs.teams.includes(m.home.id) || prefs.teams.includes(m.away.id) || prefs.leagues.includes(m.league.id);
}

export async function dispatch(env: Env, notices: Notice[]): Promise<{ sent: number; failed: number; removed: number }> {
  const keys = vapidKeys(env);
  const stats = { sent: 0, failed: 0, removed: 0 };
  if (!keys || !notices.length) return stats;
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth, prefs FROM subscriptions').all<SubRow>();
  const jobs: { sub: SubRow; n: Notice }[] = [];
  for (const sub of results) {
    let prefs: PushPrefs;
    try {
      prefs = JSON.parse(sub.prefs);
    } catch {
      continue;
    }
    for (const n of notices) if (wants(prefs, n)) jobs.push({ sub, n });
  }
  const gone = new Set<string>();
  const CONCURRENCY = 6;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(
      jobs.slice(i, i + CONCURRENCY).map(async ({ sub, n }) => {
        if (gone.has(sub.endpoint)) return;
        try {
          const r = await sendPush(sub, n.payload, keys, { topic: n.payload.tag, ttl: 1800 });
          if (r.ok) stats.sent++;
          else {
            stats.failed++;
            if (r.gone) gone.add(sub.endpoint);
            else console.warn('push failed', r.status, r.body);
          }
        } catch (e) {
          stats.failed++;
          console.warn('push error', e);
        }
      }),
    );
  }
  if (gone.size) {
    await env.DB.batch([...gone].map((e) => env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(e)));
    stats.removed = gone.size;
  }
  return stats;
}
