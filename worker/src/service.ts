// منطق التطبيق: جلب البيانات مع الذاكرة المؤقتة، وتحديث المباريات المباشرة، وإرسال التنبيهات
import type { Match, MatchDetails, PushPrefs, Standings } from '../../shared/types';
import { LEAGUES, leaguePriority } from '../../shared/leagues';
import { isAmbiguousKey, teamKey } from '../../shared/teams';
import type { Env } from './env';
import { ApiFootballProvider } from './providers/apiFootball';
import { MockProvider } from './providers/mock';
import type { Provider } from './providers/types';
import { BudgetExceededError, RetryLaterError, budgetCap, cached, type Cached, claimInterval, consumeBudget, dailyLimit, getMeta, setMeta, usageFor, usageToday, type BudgetPurpose } from './store';
import { computePlan, matchWindow, type LivePlan, type TimeWindow } from './plan';
import {
  FD_MATCH_OFFSET,
  hasSecondary,
  isSecondaryMatch,
  secondaryByIds,
  secondaryLive,
  recordTeams,
  secondaryDay,
  secondaryLeagueMatches,
  secondaryLeagues,
  secondaryMatch,
  secondaryStandings,
} from './secondary';
import { DAY_MS, localDayRange, utcDate, utcDatesCovering } from './time';
import { diffMatch, type Notice } from './notify';
import { generateVapidKeys, sendPush, type VapidKeys } from './push/webpush';

// purpose: من أي حصة يُخصم الطلب (التصفح أو المتابعة المباشرة)
// وضع الوسيط: لا اتصال مباشر بـ API-Football (يرفض Cloudflare)؛ البيانات تصل عبر مهمة GitHub
const relayOnly = (env: Env) => env.AF_VIA_RELAY === 'true';
const RELAY_PROVIDER: Provider = {
  name: 'api-football',
  limited: true,
  matchesByUtcDate: () => Promise.reject(new RetryLaterError()),
  live: () => Promise.reject(new RetryLaterError()),
  matchesByIds: () => Promise.reject(new RetryLaterError()),
  match: () => Promise.reject(new RetryLaterError()),
  standings: () => Promise.reject(new RetryLaterError()),
  leagueMatches: () => Promise.reject(new RetryLaterError()),
};

export function getProvider(env: Env, purpose: BudgetPurpose = 'browse'): Provider {
  if (env.PROVIDER === 'api-football' && relayOnly(env)) return RELAY_PROVIDER;
  if (env.PROVIDER === 'api-football') {
    if (!env.API_FOOTBALL_KEY) throw new Error('API_FOOTBALL_KEY غير مضبوط');
    return new ApiFootballProvider(env.API_FOOTBALL_KEY, {
      // البطولات التي يغطيها football-data.org تؤخذ منه، فلا نستهلك رصيد API-Football عليها
      leagues: primaryLeagues(env),
      onRequest: () => consumeBudget(env, purpose),
      memo: async (key, ttl, fn) => (await cached(env, key, ttl, fn)).value,
    });
  }
  // mock-limited: بيانات تجريبية لكن مع احتساب الحد اليومي (لتجربة سلوك الخطة المجانية محلياً)
  if (env.PROVIDER === 'mock-limited') return metered(new MockProvider(), () => consumeBudget(env, purpose));
  return new MockProvider();
}

// يغلّف مزوّداً ليحتسب كل استدعاء كطلب واحد من الحد اليومي
function metered(p: Provider, onRequest: () => Promise<void>): Provider {
  const wrap =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A) => {
      await onRequest();
      return fn.apply(p, a);
    };
  return {
    name: `${p.name}-limited`,
    limited: true,
    matchesByUtcDate: wrap(p.matchesByUtcDate),
    live: wrap(p.live),
    matchesByIds: wrap(p.matchesByIds),
    match: wrap(p.match),
    standings: wrap(p.standings),
    leagueMatches: wrap(p.leagueMatches),
  };
}

// البطولات التي تُجلب من API-Football (كلها، أو ما لا يغطيه football-data.org)
export function primaryLeagues(env: Env): number[] {
  const sec = new Set(secondaryLeagues(env));
  return LEAGUES.map((l) => l.id).filter((id) => !sec.has(id));
}

// ما تتيحه خطة البيانات الحالية
export function features(env: Env) {
  const afWindow = Number(env.DATE_WINDOW_DAYS) || 31;
  const afStandings = env.STANDINGS_ENABLED !== 'false';
  const sec = secondaryLeagues(env);
  return {
    // البطولات التي لها جدول ترتيب (من API-Football أو من football-data.org)
    standingsLeagues: afStandings ? LEAGUES.map((l) => l.id) : sec,
    standings: afStandings || sec.length > 0,
    // الأيام المتاحة لكل البطولات (API-Football)
    afWindow,
    // الأيام المتاحة إجمالاً (بعد afWindow تظهر بطولات football-data.org فقط)
    dateWindow: sec.length ? Math.max(afWindow, 7) : afWindow,
    secondary: sec.length > 0,
  };
}

// أقل مدة بين محاولتين لنفس الطلب على المزوّد المحدود (ثوانٍ)
const RETRY_SEC = 120;

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
export function dateTtl(p: Provider, date: string, now: number): number {
  if (!p.limited) return 15;
  const diffDays = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${utcDate(now)}T00:00:00Z`)) / DAY_MS);
  if (diffDays < -1) return 7 * 86400;
  if (diffDays === -1) return 6 * 3600;
  // اليوم: 3 ساعات تكفي، لأن النتائج المباشرة تأتي من المتابعة (match_state) وليس من هذه القائمة
  if (diffDays === 0) return 3 * 3600;
  return 3 * 3600;
}

async function utcDayMatches(env: Env, p: Provider, date: string, now = Date.now()) {
  return cached(
    env,
    `date:${date}`,
    dateTtl(p, date, now),
    async () => {
      const list = await p.matchesByUtcDate(date);
      // نتعلّم معرّفات الفرق لربطها ببيانات المزوّد الثاني
      if (p.limited) await recordTeams(env, list, now);
      return list;
    },
    p.limited ? 600 : 0,
  );
}

interface StateRow {
  id: number;
  status: string;
  snapshot: string;
  updated_at: number;
}

export async function loadStates(env: Env, ids: number[]): Promise<Map<number, { match: Match; updatedAt: number }>> {
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
  // نتحمّل فشل أحد الأيام (مثلاً يوم خارج نطاق الخطة) ونعرض ما توفر
  const { afWindow } = features(env);
  const now = Date.now();
  const secondary = p.limited && hasSecondary(env);
  const primarySet = new Set(primaryLeagues(env));
  // لكل يوم UTC: دوريات API-Football (ضمن نطاق خطته) + البطولات الأوروبية من football-data.org
  const loaders = utcDatesCovering(start, end).flatMap((d) => {
    const diff = Math.abs(Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${utcDate(now)}T00:00:00Z`)) / DAY_MS));
    const out: Promise<Cached<Match[]>>[] = [];
    if (!p.limited || diff <= afWindow) {
      out.push(utcDayMatches(env, p, d, now).then((r) => (secondary ? { ...r, value: r.value.filter((m) => primarySet.has(m.league.id)) } : r)));
    }
    if (secondary && diff <= 8) out.push(secondaryDay(env, d, now));
    return out;
  });
  const settled = await Promise.allSettled(loaders);
  const days = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (settled.length && !days.length) throw (settled[0] as PromiseRejectedResult).reason;
  let stale = days.length < settled.length;
  const byId = new Map<number, { match: Match; fetchedAt: number }>();
  for (const d of days) {
    stale ||= d.stale;
    for (const m of d.value) {
      const t = Date.parse(m.kickoff);
      if (t >= start && t < end) byId.set(m.id, { match: m, fetchedAt: d.fetchedAt });
    }
  }
  if (!days.length && !settled.length) return { data: [], stale: false, provider: p.name };
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
  const p = getProvider(env, 'live');
  const res = await refreshLive(env, p);
  if (ctx && res.notices.length) ctx.waitUntil(dispatch(env, res.notices));
  const since = Date.now() - 4 * 3600_000;
  const { results } = await env.DB.prepare(`SELECT snapshot, updated_at FROM match_state WHERE status IN ('live','halftime','penalties') AND updated_at > ?`)
    .bind(since)
    .all<{ snapshot: string; updated_at: number }>();
  const lastUpdate = Math.max(0, ...results.map((r) => r.updated_at));
  const plan = await currentPlan(env);
  const slowMs = plan ? plan.slowSec * 1000 : pollIntervalMs(env, p);
  const stale = results.length > 0 && Date.now() - lastUpdate > slowMs * 2 + 60_000;
  return { data: sortMatches(results.map((r) => JSON.parse(r.snapshot) as Match)), stale, provider: p.name };
}

// هل المباراة معروفة لدينا؟ (لمنع استهلاك الرصيد بمعرّفات عشوائية)
export async function isKnownMatch(env: Env, id: number): Promise<boolean> {
  const needle = `{"id":${id},`;
  const row = await env.DB.prepare(
    `SELECT 1 FROM match_state WHERE id = ?1
     UNION ALL SELECT 1 FROM cache WHERE key = ?2
     UNION ALL SELECT 1 FROM cache WHERE (key LIKE 'date:%' OR key LIKE 'league:%' OR key LIKE 'fd:date:%' OR key LIKE 'fd:league:%') AND instr(value, ?3) > 0
     LIMIT 1`,
  )
    .bind(id, `match:${id}`, needle)
    .first();
  return !!row;
}

export async function matchDetails(env: Env, id: number) {
  const p = getProvider(env);
  if (p.limited && !(await isKnownMatch(env, id))) return { data: null, stale: false, provider: p.name };
  if (isSecondaryMatch(id)) {
    if (!hasSecondary(env)) return { data: null, stale: false, provider: p.name };
    const r = await secondaryMatch(env, id);
    let data = r.value;
    // أثناء المباراة: أحدث نتيجة من المتابعة المباشرة
    const s = (await loadStates(env, [id])).get(id);
    if (data && s && s.updatedAt > r.fetchedAt) data = { ...data, ...s.match };
    return { data, stale: r.stale, provider: 'football-data' };
  }
  if (relayOnly(env) && p.limited) {
    const s = (await loadStates(env, [id])).get(id);
    if (s) return { data: s.match as MatchDetails, stale: false, provider: p.name };
    const row = await env.DB.prepare(`SELECT value FROM cache WHERE key LIKE 'date:%' AND instr(value, ?1) > 0 LIMIT 1`).bind(`{"id":${id},`).first<{ value: string }>();
    const m = row ? (JSON.parse(row.value) as Match[]).find((x) => x.id === id) : undefined;
    return { data: (m as MatchDetails) ?? null, stale: false, provider: p.name };
  }
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
    p.limited ? RETRY_SEC : 0,
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
  if (p.limited && hasSecondary(env) && secondaryLeagues(env).includes(leagueId)) {
    const r = await secondaryStandings(env, leagueId);
    return { data: r.value, stale: r.stale, provider: 'football-data' };
  }
  const r = await cached<Standings | null>(env, `standings:${leagueId}`, p.limited ? 6 * 3600 : 60, () => p.standings(leagueId), p.limited ? RETRY_SEC : 0);
  return { data: r.value, stale: r.stale, provider: p.name };
}

export async function leagueMatches(env: Env, leagueId: number) {
  const p = getProvider(env);
  if (p.limited && hasSecondary(env) && secondaryLeagues(env).includes(leagueId)) {
    const r = await secondaryLeagueMatches(env, leagueId);
    return { data: r.value, stale: r.stale, provider: 'football-data' };
  }
  const r = await cached(env, `league:${leagueId}`, p.limited ? 3 * 3600 : 30, () => p.leagueMatches(leagueId), p.limited ? RETRY_SEC : 0);
  return { data: r.value, stale: r.stale, provider: p.name };
}

export async function budgetInfo(env: Env) {
  const p = getProvider(env);
  const plan = p.limited ? await currentPlan(env) : null;
  return {
    limited: p.limited,
    used: p.limited ? await usageToday(env) : 0,
    limit: p.limited ? dailyLimit(env) : null,
    pollSeconds: plan ? plan.slowSec : pollIntervalMs(env, p) / 1000,
    // تحديث مباريات الفرق المفضلة (أسرع)
    favPollSeconds: plan ? plan.fastSec : pollIntervalMs(env, p) / 1000,
    // البطولات الأوروبية الكبرى (football-data.org): فحص كل دقيقة
    secondaryPollSeconds: p.limited && hasSecondary(env) ? 60 : null,
  };
}

async function currentPlan(env: Env): Promise<LivePlan | null> {
  const raw = await getMeta(env, 'live_plan');
  return raw ? (JSON.parse(raw) as LivePlan) : null;
}

// الفرق ذات الأولوية = الفرق المفضلة لدى المشتركين في التنبيهات
interface Priority {
  ids: Set<number>;
  keys: Set<string>;
}
let favCache: { at: number; fav: Priority } | null = null;
export const invalidatePriorityTeams = () => void (favCache = null);
async function priorityTeams(env: Env, now: number): Promise<Priority> {
  if (favCache && now - favCache.at < 120_000) return favCache.fav;
  const { results } = await env.DB.prepare('SELECT prefs FROM subscriptions').all<{ prefs: string }>();
  const fav: Priority = { ids: new Set(), keys: new Set() };
  for (const r of results) {
    try {
      const prefs = JSON.parse(r.prefs) as PushPrefs;
      for (const t of prefs.teams ?? []) fav.ids.add(t);
      for (const k of prefs.teamKeys ?? []) fav.keys.add(k);
    } catch {
      /* تجاهل */
    }
  }
  favCache = { at: now, fav };
  return fav;
}

const keyMatch = (keys: { has(k: string): boolean; size?: number }, t: { name: string; short?: string }) => {
  const k = teamKey(t.name, t.short);
  return !isAmbiguousKey(k) && keys.has(k);
};
const isFavTeam = (fav: Priority, t: { id: number; name: string; short?: string }) => fav.ids.has(t.id) || (fav.keys.size > 0 && keyMatch(fav.keys, t));

// ---------- المتابعة المباشرة ----------

export interface RefreshResult {
  polled: boolean;
  reason?: string;
  notices: Notice[];
}

// يحدّث المباشر من المصدرين: API-Football (دورياته) و football-data.org (البطولات الأوروبية الكبرى)
export async function refreshLive(env: Env, p: Provider = getProvider(env, 'live'), now = Date.now()): Promise<RefreshResult> {
  const [a, b] = await Promise.all([
    refreshPrimary(env, p, now),
    hasSecondary(env) && p.limited ? refreshSecondary(env, now) : Promise.resolve<RefreshResult>({ polled: false, reason: 'off', notices: [] }),
  ]);
  return { polled: a.polled || b.polled, reason: a.polled ? a.reason : b.polled ? b.reason : a.reason, notices: [...a.notices, ...b.notices] };
}

type OpenRow = { id: number; snapshot: string };

// يكتب الحالات الجديدة ويُرجع التنبيهات الناتجة عن التغيّر
export async function applyUpdates(env: Env, updates: Match[], now: number, extra: D1PreparedStatement[] = []): Promise<Notice[]> {
  const prevStates = await loadStates(env, updates.map((m) => m.id));
  const notices: Notice[] = [];
  const writes: D1PreparedStatement[] = [...extra];
  for (const m of updates) {
    notices.push(...diffMatch(prevStates.get(m.id)?.match, m));
    writes.push(
      env.DB.prepare(
        `INSERT INTO match_state (id, status, kickoff, snapshot, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
      ).bind(m.id, m.status, Date.parse(m.kickoff), JSON.stringify(m), now),
    );
  }
  if (writes.length) await env.DB.batch(writes);
  return notices;
}

// نزرع حالة "لم تبدأ" للمباريات القريبة حتى نكتشف لحظة انطلاقها
async function seedSoon(env: Env, schedule: Match[], now: number): Promise<void> {
  const soon = schedule.filter((m) => {
    const t = Date.parse(m.kickoff);
    return m.status === 'scheduled' && t <= now + 2 * 60_000 && t > now - 3 * 3600_000;
  });
  if (!soon.length) return;
  await env.DB.batch(
    soon.map((m) =>
      env.DB.prepare('INSERT OR IGNORE INTO match_state (id, status, kickoff, snapshot, updated_at) VALUES (?, ?, ?, ?, ?)').bind(m.id, m.status, Date.parse(m.kickoff), JSON.stringify(m), 0),
    ),
  );
}

// football-data.org: لا حد يومي (10 طلبات/دقيقة)، فنفحص كل دقيقة أثناء مباريات بطولاته
async function refreshSecondary(env: Env, now: number): Promise<RefreshResult> {
  const { results: openRows } = await env.DB.prepare(`SELECT id, snapshot FROM match_state WHERE status IN ('live','halftime','penalties') AND id >= ?`)
    .bind(FD_MATCH_OFFSET)
    .all<OpenRow>();
  let schedule: Match[] = [];
  try {
    schedule = (await secondaryDay(env, utcDate(now), now)).value;
  } catch (e) {
    console.warn('fd schedule failed', e);
  }
  await seedSoon(env, schedule, now);
  const states = await loadStates(env, schedule.map((m) => m.id));
  const active =
    openRows.length > 0 ||
    schedule.some((m) => {
      const w = matchWindow(states.get(m.id)?.match ?? m, now);
      return !!w && w.start <= now && now < w.end;
    });
  if (!active) return { polled: false, reason: 'no-matches', notices: [] };
  if (!(await claimInterval(env, 'fd_live_poll', 58_000, now))) return { polled: false, reason: 'interval', notices: [] };
  try {
    const live = await secondaryLive(env);
    const liveIds = new Set(live.map((m) => m.id));
    const gone = openRows.map((r) => r.id).filter((id) => !liveIds.has(id));
    const finals = gone.length ? await secondaryByIds(env, gone) : [];
    // نحتفظ بالأحداث القادمة من API-Football (عبر الوسيط)، ولا نُنقص نتيجة سجّلها مصدر أسرع
    const stored = await loadStates(env, [...live, ...finals].map((m) => m.id));
    const merged = [...live, ...finals].map((m) => {
      const s = stored.get(m.id)?.match;
      if (!s) return m;
      const pick = (x: number | null, y: number | null) => (x == null ? y : y == null ? x : Math.max(x, y));
      return {
        ...m,
        events: s.events?.length ? s.events : m.events,
        score: m.status === 'finished' ? m.score : { home: pick(m.score.home, s.score.home), away: pick(m.score.away, s.score.away) },
      };
    });
    const notices = await applyUpdates(env, merged, now, [env.DB.prepare("DELETE FROM meta WHERE key = 'fd_error'")]);
    return { polled: true, notices };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await setMeta(env, 'fd_error', JSON.stringify({ at: new Date(now).toISOString(), msg: msg.slice(0, 300) }));
    console.warn('fd live poll failed', msg);
    return { polled: false, reason: 'error', notices: [] };
  }
}

async function refreshPrimary(env: Env, p: Provider, now: number): Promise<RefreshResult> {
  // المباريات التي كانت جارية في آخر فحص (من هذا المصدر فقط)
  const { results: openRows } = await env.DB.prepare(`SELECT id, snapshot FROM match_state WHERE status IN ('live','halftime','penalties') AND id < ?`)
    .bind(FD_MATCH_OFFSET)
    .all<OpenRow>();

  // جدول اليوم (وأمس في الساعات الأولى فقط، لمباريات منتصف الليل)
  let schedule: Match[] = [];
  try {
    const dates = new Date(now).getUTCHours() < 4 ? [utcDate(now - DAY_MS), utcDate(now)] : [utcDate(now)];
    const days = await Promise.all(dates.map((d) => utcDayMatches(env, p, d, now)));
    schedule = days.flatMap((d) => d.value);
  } catch (e) {
    console.warn('schedule load failed', e);
  }
  await seedSoon(env, schedule, now);

  let intervalMs = pollIntervalMs(env, p);
  if (p.limited) {
    // نحسب الخطة من: مباريات اليوم المتبقية، الفرق المفضلة، والرصيد المتبقي
    const states = await loadStates(env, schedule.map((m) => m.id));
    const byId = new Map<number, Match>(schedule.map((m) => [m.id, states.get(m.id)?.match ?? m]));
    for (const r of openRows) if (!byId.has(r.id)) byId.set(r.id, JSON.parse(r.snapshot) as Match);
    const fav = await priorityTeams(env, now);
    const all: TimeWindow[] = [];
    const favW: TimeWindow[] = [];
    for (const m of byId.values()) {
      const w = matchWindow(m, now);
      if (!w) continue;
      all.push(w);
      if (isFavTeam(fav, m.home) || isFavTeam(fav, m.away)) favW.push(w);
    }
    const remaining = budgetCap(env, 'live') - (await usageFor(env, 'live'));
    const plan = computePlan({ favWindows: favW, allWindows: all, remaining, now, slowFloorSec: pollIntervalMs(env, p) / 1000 });
    await setMeta(env, 'live_plan', JSON.stringify(plan));
    if (plan.mode === 'idle') return { polled: false, reason: 'no-matches', notices: [] };
    if (plan.mode === 'budget') return { polled: false, reason: 'budget', notices: [] };
    // المتابعة تتم عبر مهمة GitHub (انظر relay.ts)
    if (relayOnly(env)) return { polled: false, reason: 'relay', notices: [] };
    intervalMs = (plan.mode === 'fast' ? plan.fastSec : plan.slowSec) * 1000;
  }
  if (!(await claimInterval(env, 'live_poll', intervalMs - 2000, now))) return { polled: false, reason: 'interval', notices: [] };

  let live: Match[];
  let finals: Match[];
  try {
    live = await p.live();
    const liveIds = new Set(live.map((m) => m.id));
    const gone = openRows.map((r) => r.id).filter((id) => !liveIds.has(id));
    finals = gone.length ? await p.matchesByIds(gone) : [];
  } catch (e) {
    if (e instanceof BudgetExceededError) return { polled: false, reason: 'budget', notices: [] };
    // فشل مؤقت: نعيد المحاولة بتباعد متزايد (3، 6، 12... دقيقة، حتى الفترة المخططة) حتى لا يُهدر الرصيد
    const failures = Number((await getMeta(env, 'live_failures')) ?? 0) + 1;
    // حتى ساعة كحد أقصى (رفض متكرر من المزوّد يعني أن الانتظار القصير يهدر الرصيد فقط)
    const retryMs = Math.min(60 * 60_000, 3 * 60_000 * 2 ** Math.min(failures - 1, 6));
    await setMeta(env, 'live_failures', String(failures));
    await setMeta(env, 'live_poll', String(now - intervalMs + retryMs));
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await setMeta(env, 'af_last', JSON.stringify({ at: new Date(now).toISOString(), ok: false, colo: (p as { lastColo?: string }).lastColo ?? '' }));
    // آخر خطأ يُحفظ للتشخيص (يظهر أيضاً في /api/meta)
    await setMeta(env, 'live_error', JSON.stringify({ at: new Date(now).toISOString(), msg: msg.slice(0, 300) }));
    console.warn('live poll failed', msg);
    return { polled: false, reason: 'error', notices: [] };
  }
  const updates = [...live, ...finals];
  const notices = await applyUpdates(env, updates, now, [
    env.DB.prepare("DELETE FROM meta WHERE key IN ('live_error', 'live_failures')"),
    env.DB.prepare("INSERT INTO meta (key, value) VALUES ('af_last', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(
      JSON.stringify({ at: new Date(now).toISOString(), ok: true, colo: (p as { lastColo?: string }).lastColo ?? '' }),
    ),
  ]);
  if (p.limited) await recordTeams(env, updates, now);
  return { polled: true, notices };
}

// ---------- إرسال التنبيهات ----------

// مفاتيح VAPID: من الأسرار إن وُجدت، وإلا تُولَّد تلقائياً مرة واحدة وتُحفظ في D1
let cachedKeys: VapidKeys | null = null;
export async function vapidKeys(env: Env): Promise<VapidKeys> {
  const subject = env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject };
  if (cachedKeys) return { ...cachedKeys, subject };
  let stored = await getMeta(env, 'vapid_keys');
  if (!stored) {
    const generated = await generateVapidKeys();
    // INSERT OR IGNORE: إن سبقتنا نسخة أخرى نستخدم مفاتيحها
    await env.DB.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').bind('vapid_keys', JSON.stringify(generated)).run();
    stored = await getMeta(env, 'vapid_keys');
  }
  const k = JSON.parse(stored!) as { publicKey: string; privateKey: string };
  cachedKeys = { ...k, subject };
  return cachedKeys;
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
  if (prefs.teams.includes(m.home.id) || prefs.teams.includes(m.away.id) || prefs.leagues.includes(m.league.id)) return true;
  // المعرّفات تختلف بين المصدرين: نطابق أيضاً بالاسم الموحّد (عدا الأسماء المشتركة)
  const keys = new Set(prefs.teamKeys ?? []);
  return keys.size > 0 && (keyMatch(keys, m.home) || keyMatch(keys, m.away));
}

export async function dispatch(env: Env, notices: Notice[]): Promise<{ sent: number; failed: number; removed: number }> {
  const stats = { sent: 0, failed: 0, removed: 0 };
  if (!notices.length) return stats;
  const keys = await vapidKeys(env);
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
