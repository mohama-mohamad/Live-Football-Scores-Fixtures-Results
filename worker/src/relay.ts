// وسيط API-Football عبر GitHub Actions:
// API-Football يرفض الطلبات القادمة من خوادم Cloudflare، فتجلب مهمة GitHub (af-relay.yml) البيانات
// وترسلها إلى هنا موقّعة بـ HMAC باستخدام مفتاح API-Football نفسه (لا حاجة لسر إضافي).
//   GET  /api/__relay/plan    ← ماذا تحتاج؟ (مباشر؟ أي أيام؟ أي مباريات انتهت؟)
//   POST /api/__relay/ingest  ← البيانات (موقّعة)
import type { Match, MatchDetails, MatchEvent } from '../../shared/types';
import { LEAGUES } from '../../shared/leagues';
import { teamKey } from '../../shared/teams';
import type { Env } from './env';
import { normFixture, slim } from './providers/apiFootball';
import { MATCH_MS, computePlan, matchWindow, type TimeWindow } from './plan';
import { FD_MATCH_OFFSET, recordTeams, secondaryLeagues } from './secondary';
import { budgetCap, getMeta, setMeta, usageFor } from './store';
import { DAY_MS, utcDate } from './time';
import { applyUpdates, dateTtl, dispatch, getProvider, isFavTeam, loadStates, priorityTeams } from './service';
import type { Notice } from './notify';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export const relayMode = (env: Env) => env.AF_VIA_RELAY === 'true' && !!env.API_FOOTBALL_KEY;

const enc = new TextEncoder();
const MAX_AGE_MS = 15 * 60_000;
const LINEUP_LOOKAHEAD_MS = 60 * 60_000;
const VIEW_TTL_MS = 30 * 60_000;
const DETAIL_REFRESH_MS = 10 * 60_000;
// طلبات التفاصيل لكل تشغيل، وما نحتفظ به من الحد اليومي للمتابعة المباشرة
const DETAIL_PER_RUN = 2;
// تقدير طلبات التفاصيل لمباراة متابَعة (تشكيلة قبل البداية + إحصائيات كل 10 دقائق)
const DETAILS_PER_MATCH = 14;
const MAX_WAIT_MS = 30 * 60_000;

export async function verifySignature(secret: string, body: string, signatureHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = new Uint8Array(signatureHex.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(body));
}

async function addUsage(env: Env, purpose: 'live' | 'browse', n: number): Promise<void> {
  if (n <= 0) return;
  await env.DB.prepare(`INSERT INTO usage (day, count) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET count = count + ?2`)
    .bind(`${utcDate(Date.now())}:${purpose}`, n)
    .run();
}

async function cachedValue<T>(env: Env, key: string): Promise<{ value: T; expires: number } | null> {
  const row = await env.DB.prepare('SELECT value, expires_at FROM cache WHERE key = ?').bind(key).first<{ value: string; expires_at: number }>();
  return row ? { value: JSON.parse(row.value) as T, expires: row.expires_at } : null;
}

// ---------- الخطة ----------

export async function relayPlan(env: Env, now = Date.now()) {
  const leagues = LEAGUES.map((l) => l.id);
  const today = utcDate(now);
  const days: string[] = [];
  const browseLeft = budgetCap(env, 'browse') - (await usageFor(env, 'browse'));
  for (const d of [utcDate(now - DAY_MS), today, utcDate(now + DAY_MS)]) {
    const c = await cachedValue<Match[]>(env, `date:${d}`);
    if ((!c || c.expires < now) && days.length < browseLeft - 2) days.push(d);
  }

  // مباريات اليوم (وأمس لما بعد منتصف الليل) من API-Football، ومن football-data.org
  const af: Match[] = [];
  for (const d of [utcDate(now - DAY_MS), today]) af.push(...((await cachedValue<Match[]>(env, `date:${d}`))?.value ?? []));
  const fd = (await cachedValue<Match[]>(env, `fd:date:${today}`))?.value ?? [];
  const { results: open } = await env.DB.prepare(`SELECT id, kickoff FROM match_state WHERE status IN ('live','halftime','penalties')`).all<{ id: number; kickoff: number }>();
  const states = await loadStates(env, [...af, ...fd].map((m) => m.id));
  const cur = (m: Match) => states.get(m.id)?.match ?? m;
  const liveLeft = budgetCap(env, 'live') - (await usageFor(env, 'live'));

  // المباريات التي يتابعها المستخدم: فرقه المفضلة + المباريات التي فتح صفحتها مؤخراً
  const fav = await priorityTeams(env, now);
  const viewed = await recentViews(env, now);
  const fdById = new Map(fd.map((m) => [m.id, m]));
  const viewedPairs = new Set([...viewed].map((id) => fdById.get(id)).filter((m): m is Match => !!m).map(pairKey));
  const followed = (m: Match) => viewed.has(m.id) || viewedPairs.has(pairKey(m)) || isFavTeam(fav, m.home) || isFavTeam(fav, m.away);

  const windowOf = (m: Match) => matchWindow(cur(m), now);
  const isWin = (w: TimeWindow | null): w is TimeWindow => !!w;
  // حالات جارية لم تعد في القوائم: نتابعها ربع ساعة أخرى
  const listed = new Set([...af, ...fd].map((m) => m.id));
  const openWin = open.filter((r) => !listed.has(r.id)).map(() => ({ start: now - 1, end: now + 15 * 60_000 }));
  const allWindows = [...[...af, ...fd].map(windowOf).filter(isWin), ...openWin];
  const favWindows = [...af, ...fd].filter(followed).map(windowOf).filter(isWin);

  // الإحصائيات والتشكيلة: طلب مستقل لكل مباراة (الخطة المجانية لا تسمح بعدة مباريات في طلب واحد)
  const soon = (m: Match) => cur(m).status === 'scheduled' && Date.parse(m.kickoff) - now < LINEUP_LOOKAHEAD_MS && Date.parse(m.kickoff) > now - MATCH_MS;
  const inWindow = (m: Match) => {
    const w = windowOf(m);
    return !!w && w.start <= now;
  };
  const cand = af.filter((m) => followed(m) && (inWindow(m) || soon(m)));
  const got = await extraInfo(env, cand.map((m) => m.id));
  const dueAt = (m: Match) => {
    const x = got.get(m.id);
    if (!x) return now;
    // قبل البداية: حتى تُعلن التشكيلة فقط
    if (soon(m) && x.lineups) return Infinity;
    return x.at + DETAIL_REFRESH_MS;
  };
  const due = cand.filter((m) => dueAt(m) <= now).sort((a, b) => Number(inWindow(b)) - Number(inWindow(a)));
  const full = liveLeft > 1 ? due.slice(0, DETAIL_PER_RUN).map((m) => m.id) : [];

  // تحديث كل المباريات الجارية (النتيجة والأحداث) بطلب واحد؛ وتيرته حسب الرصيد المتبقي
  const followedLeft = af.filter((m) => followed(m) && windowOf(m)).length;
  const reserve = Math.min(Math.max(0, liveLeft - 2), followedLeft * DETAILS_PER_MATCH);
  const p = computePlan({
    favWindows,
    allWindows,
    remaining: liveLeft - reserve,
    now,
    slowFloorSec: Math.max(300, Number(env.LIVE_POLL_SECONDS) || 600),
    fastFloorSec: 120,
  });
  const interval = p.mode === 'fast' ? p.fastSec : p.mode === 'slow' ? p.slowSec : null;
  const lastScan = Number((await getMeta(env, 'relay_scan_at')) ?? 0);
  const live = interval != null && liveLeft > 1 && now - lastScan >= (interval - 20) * 1000;

  // متى نسأل مجدداً؟
  const waits: number[] = [];
  if (interval != null) waits.push(live ? interval * 1000 : lastScan + interval * 1000 - now);
  for (const m of cand) if (!full.includes(m.id)) waits.push(dueAt(m) - now);
  for (const w of allWindows) if (w.start > now) waits.push(w.start - now);
  for (const m of af) if (followed(m)) waits.push(Date.parse(m.kickoff) - LINEUP_LOOKAHEAD_MS - now);
  const next = Math.round(Math.min(MAX_WAIT_MS, ...waits.filter((w) => w > 0 && Number.isFinite(w))) / 1000);

  // مباريات API-Football كانت جارية: إن اختفت من المباشر نجلب قائمة يومها لمعرفة النتيجة النهائية
  const openDays = live && browseLeft > 1 ? Object.fromEntries(open.filter((r) => r.id < FD_MATCH_OFFSET).map((r) => [r.id, utcDate(r.kickoff)])) : {};
  return { leagues, live, full, openDays, days, next: Math.max(60, next), mode: p.mode, fastSec: p.fastSec, slowSec: p.slowSec, liveLeft, browseLeft };
}

// صفحات المباريات المفتوحة (لجلب تفاصيلها عبر الوسيط)
export async function noteView(env: Env, id: number, now = Date.now()): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO cache (key, value, fetched_at, expires_at) VALUES (?1, '1', ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, expires_at = excluded.expires_at WHERE cache.fetched_at < ?2 - 300000`,
  )
    .bind(`view:${id}`, now, now + VIEW_TTL_MS)
    .run();
}

async function recentViews(env: Env, now: number): Promise<Set<number>> {
  const { results } = await env.DB.prepare(`SELECT key FROM cache WHERE key LIKE 'view:%' AND expires_at > ?`).bind(now).all<{ key: string }>();
  return new Set(results.map((r) => Number(r.key.slice(5))));
}

async function extraInfo(env: Env, ids: number[]): Promise<Map<number, { at: number; lineups: boolean }>> {
  const out = new Map<number, { at: number; lineups: boolean }>();
  if (!ids.length) return out;
  const { results } = await env.DB.prepare(
    `SELECT key, fetched_at, instr(value, '"startXI":[{') > 0 AS lu FROM cache WHERE key IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids.map((id) => `extra:${id}`))
    .all<{ key: string; fetched_at: number; lu: number }>();
  for (const r of results) out.set(Number(r.key.slice(6)), { at: r.fetched_at, lineups: !!r.lu });
  return out;
}

// ---------- الاستقبال ----------

export interface RelayBody {
  ts: number;
  live?: Json[] | null;
  finals?: Json[] | null;
  // fixtures?id= (مباراة لكل طلب): أحداث + إحصائيات + تشكيلة
  full?: Json[] | null;
  days?: Record<string, Json[]>;
}

const pairKey = (m: Match) => `${teamKey(m.home.name, m.home.short)}|${teamKey(m.away.name, m.away.short)}`;
const inPlay = (m: Match) => m.status === 'live' || m.status === 'halftime' || m.status === 'penalties';

function maxScore(a: Match['score'], b: Match['score']): Match['score'] {
  const pick = (x: number | null, y: number | null) => (x == null ? y : y == null ? x : Math.max(x, y));
  return { home: pick(a.home, b.home), away: pick(a.away, b.away) };
}

// الإحصائيات والتشكيلة (لا تُحفظ في حالة المباراة) — تُقرأ عند فتح صفحة المباراة
// full: رد طلب التفاصيل (يُحفظ دائماً لتسجيل وقت الجلب، حتى قبل إعلان التشكيلة)
function extraStmt(env: Env, id: number, m: MatchDetails, now: number, full: boolean): D1PreparedStatement | null {
  // ردود المباشر لا تحمل الإحصائيات والتشكيلة: لا نستبدل ما حُفظ سابقاً
  if (!full && !m.stats?.length && !m.lineups?.length) return null;
  const ttl = m.status === 'finished' ? 7 * DAY_MS : 12 * 3600_000;
  return env.DB.prepare(
    `INSERT INTO cache (key, value, fetched_at, expires_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
  ).bind(`extra:${id}`, JSON.stringify({ stats: m.stats ?? [], lineups: m.lineups ?? [] }), now, now + ttl);
}

// يضيف أحداث API-Football (الهدافون، البطاقات...) إلى مباريات football-data.org المقابلة
async function enrichSecondary(env: Env, list: MatchDetails[], now: number, extras: D1PreparedStatement[], fullIds: Set<number>): Promise<Notice[]> {
  if (!list.length) return [];
  const { results } = await env.DB.prepare(`SELECT id, snapshot FROM match_state WHERE id >= ?1 AND kickoff BETWEEN ?2 AND ?3`)
    .bind(FD_MATCH_OFFSET, now - DAY_MS, now + DAY_MS)
    .all<{ id: number; snapshot: string }>();
  const candidates: Match[] = results.map((r) => JSON.parse(r.snapshot) as Match);
  // المباريات التي لم تُسجَّل حالتها بعد: من قائمة اليوم
  for (const d of [utcDate(now - DAY_MS), utcDate(now)]) {
    for (const m of (await cachedValue<Match[]>(env, `fd:date:${d}`))?.value ?? []) if (!candidates.some((c) => c.id === m.id)) candidates.push(m);
  }
  const byPair = new Map(candidates.map((m) => [pairKey(m), m]));
  const merged: Match[] = [];
  for (const af of list) {
    const fd = byPair.get(pairKey(af));
    if (!fd || Math.abs(Date.parse(fd.kickoff) - Date.parse(af.kickoff)) > 3 * 3600_000) continue;
    // معرّفات الفرق في الأحداث يجب أن تطابق معرّفات فرق مباراة football-data.org
    const teamMap = new Map([
      [af.home.id, fd.home.id],
      [af.away.id, fd.away.id],
    ]);
    const events: MatchEvent[] = (af.events ?? []).map((e) => ({ ...e, teamId: teamMap.get(e.teamId) ?? e.teamId }));
    const finished = af.status === 'finished' || fd.status === 'finished';
    const lineups = af.lineups?.map((l) => ({ ...l, teamId: teamMap.get(l.teamId) ?? l.teamId }));
    const x = extraStmt(env, fd.id, { ...af, lineups }, now, fullIds.has(af.id));
    if (x) extras.push(x);
    merged.push({
      ...fd,
      events,
      minute: af.minute ?? fd.minute,
      status: finished ? 'finished' : inPlay(af) ? af.status : fd.status,
      score: finished ? (af.status === 'finished' ? af.score : fd.score) : maxScore(fd.score, af.score),
      penalties: af.penalties ?? fd.penalties,
    });
  }
  return applyUpdates(env, merged, now);
}

export async function relayIngest(env: Env, body: RelayBody, now = Date.now()) {
  const p = getProvider(env, 'browse');
  const days = body.days ?? {};
  await addUsage(env, 'live', (body.live ? 1 : 0) + (body.finals?.length ? 1 : 0) + (body.full?.length ?? 0));
  await addUsage(env, 'browse', Object.keys(days).length);

  // قوائم الأيام
  const dayLists: Match[][] = [];
  for (const [date, raw] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(raw)) continue;
    const list = raw.map((f) => slim(normFixture(f)));
    dayLists.push(list);
    await env.DB.prepare(
      `INSERT INTO cache (key, value, fetched_at, expires_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    )
      .bind(`date:${date}`, JSON.stringify(list), now, now + dateTtl(p, date, now) * 1000)
      .run();
    await recordTeams(env, list, now);
  }

  // المباشر
  const notices: Notice[] = [];
  const extras: D1PreparedStatement[] = [];
  const byId = new Map<number, MatchDetails>();
  const fullIds = new Set<number>((body.full ?? []).map((f) => Number(f?.fixture?.id)));
  for (const f of [...(body.live ?? []), ...(body.finals ?? []), ...(body.full ?? [])]) {
    const m = normFixture(f);
    byId.set(m.id, m);
  }
  // مباريات جارية عندنا اختفت من المباشر: نتيجتها النهائية من قائمة يومها
  const { results: open } = await env.DB.prepare(`SELECT id FROM match_state WHERE id < ?1 AND status IN ('live','halftime','penalties')`)
    .bind(FD_MATCH_OFFSET)
    .all<{ id: number }>();
  for (const r of open) {
    if (byId.has(r.id)) continue;
    const m = dayLists.flat().find((x) => x.id === r.id);
    if (m && !inPlay(m)) byId.set(m.id, m);
  }
  const live = [...byId.values()];
  if (live.length) {
    await recordTeams(env, live, now);
    const sec = new Set(secondaryLeagues(env));
    const primary = live.filter((m) => !sec.has(m.league.id));
    // بمعرّف API-Football دائماً (تعتمد عليه الخطة لمعرفة وقت آخر جلب)، وبمعرّف football-data.org أيضاً للمباريات المقابلة
    for (const m of live) {
      const x = extraStmt(env, m.id, m, now, fullIds.has(m.id));
      if (x) extras.push(x);
    }
    notices.push(...(await applyUpdates(env, primary.map(slim), now)));
    notices.push(...(await enrichSecondary(env, live.filter((m) => sec.has(m.league.id)), now, extras, fullIds)));
    for (let i = 0; i < extras.length; i += 50) await env.DB.batch(extras.slice(i, i + 50));
  }
  if (body.live || body.full) await setMeta(env, 'relay_live_at', String(now));
  if (body.live) await setMeta(env, 'relay_scan_at', String(now));
  await setMeta(env, 'relay_last', JSON.stringify({ at: new Date(now).toISOString(), live: body.live?.length ?? null, full: body.full?.length ?? 0, extras: extras.length, finals: body.finals?.length ?? 0, days: Object.keys(days) }));
  const stats = notices.length ? await dispatch(env, notices) : null;
  return { ok: true, notices: notices.length, stats };
}

export async function lastRelay(env: Env): Promise<unknown> {
  const raw = await getMeta(env, 'relay_last');
  return raw ? JSON.parse(raw) : null;
}

export const RELAY_MAX_AGE_MS = MAX_AGE_MS;
