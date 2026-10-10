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
import { matchWindow } from './plan';
import { FD_MATCH_OFFSET, recordTeams, secondaryLeagues } from './secondary';
import { budgetCap, getMeta, setMeta, usageFor } from './store';
import { DAY_MS, utcDate } from './time';
import { applyUpdates, dateTtl, dispatch, getProvider, loadStates } from './service';
import type { Notice } from './notify';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export const relayMode = (env: Env) => env.AF_VIA_RELAY === 'true' && !!env.API_FOOTBALL_KEY;

const enc = new TextEncoder();
const MAX_AGE_MS = 15 * 60_000;

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

  // هل توجد مباراة جارية أو على وشك البدء؟ (من قوائم اليوم + الحالات المفتوحة)
  const schedule = [...((await cachedValue<Match[]>(env, `date:${today}`))?.value ?? []), ...((await cachedValue<Match[]>(env, `fd:date:${today}`))?.value ?? [])];
  const { results: open } = await env.DB.prepare(`SELECT id, snapshot FROM match_state WHERE status IN ('live','halftime','penalties')`).all<{ id: number; snapshot: string }>();
  const states = await loadStates(env, schedule.map((m) => m.id));
  const active =
    open.length > 0 ||
    schedule.some((m) => {
      const w = matchWindow(states.get(m.id)?.match ?? m, now);
      return !!w && w.start <= now && now < w.end;
    });
  const liveLeft = budgetCap(env, 'live') - (await usageFor(env, 'live'));
  const live = active && liveLeft > 1;
  // مباريات API-Football كانت جارية: نطلب نتيجتها النهائية إن اختفت من قائمة المباشر
  const ids = open.filter((r) => r.id < FD_MATCH_OFFSET).map((r) => r.id).slice(0, 20);
  return { leagues, live, days, ids: live ? ids : [], liveLeft, browseLeft };
}

// ---------- الاستقبال ----------

export interface RelayBody {
  ts: number;
  live?: Json[] | null;
  finals?: Json[] | null;
  days?: Record<string, Json[]>;
}

const pairKey = (m: Match) => `${teamKey(m.home.name, m.home.short)}|${teamKey(m.away.name, m.away.short)}`;
const inPlay = (m: Match) => m.status === 'live' || m.status === 'halftime' || m.status === 'penalties';

function maxScore(a: Match['score'], b: Match['score']): Match['score'] {
  const pick = (x: number | null, y: number | null) => (x == null ? y : y == null ? x : Math.max(x, y));
  return { home: pick(a.home, b.home), away: pick(a.away, b.away) };
}

// يضيف أحداث API-Football (الهدافون، البطاقات...) إلى مباريات football-data.org المقابلة
async function enrichSecondary(env: Env, list: MatchDetails[], now: number): Promise<Notice[]> {
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
  await addUsage(env, 'live', (body.live ? 1 : 0) + (body.finals?.length ? 1 : 0));
  await addUsage(env, 'browse', Object.keys(days).length);

  // قوائم الأيام
  for (const [date, raw] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(raw)) continue;
    const list = raw.map((f) => slim(normFixture(f)));
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
  const live = [...(body.live ?? []), ...(body.finals ?? [])].map((f) => normFixture(f));
  if (live.length) {
    await recordTeams(env, live, now);
    const sec = new Set(secondaryLeagues(env));
    notices.push(...(await applyUpdates(env, live.filter((m) => !sec.has(m.league.id)).map(slim), now)));
    notices.push(...(await enrichSecondary(env, live.filter((m) => sec.has(m.league.id)), now)));
  }
  if (body.live) await setMeta(env, 'relay_live_at', String(now));
  await setMeta(env, 'relay_last', JSON.stringify({ at: new Date(now).toISOString(), live: body.live?.length ?? null, finals: body.finals?.length ?? 0, days: Object.keys(days) }));
  const stats = notices.length ? await dispatch(env, notices) : null;
  return { ok: true, notices: notices.length, stats };
}

export async function lastRelay(env: Env): Promise<unknown> {
  const raw = await getMeta(env, 'relay_last');
  return raw ? JSON.parse(raw) : null;
}

export const RELAY_MAX_AGE_MS = MAX_AGE_MS;
