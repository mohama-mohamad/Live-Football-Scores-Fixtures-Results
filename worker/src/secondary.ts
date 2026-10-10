// تكامل المزوّد الثاني (football-data.org) + ربط الفرق بين المزوّدين بالاسم
import type { Match, MatchDetails, Standings, Team } from '../../shared/types';
import { teamKey } from '../../shared/teams';
import type { Env } from './env';
import { FD_CODES, FD_MATCH_OFFSET, FD_TEAM_OFFSET, FootballDataClient } from './providers/footballData';
import { RetryLaterError, cached, rateLimit } from './store';
import { DAY_MS, utcDate } from './time';

export { FD_MATCH_OFFSET, FD_TEAM_OFFSET };

export const hasSecondary = (env: Env) => !!env.FOOTBALL_DATA_KEY;
export const secondaryLeagues = (env: Env): number[] => (hasSecondary(env) ? Object.keys(FD_CODES).map(Number) : []);
export const isSecondaryMatch = (id: number) => id >= FD_MATCH_OFFSET;

function client(env: Env): FootballDataClient {
  // الخطة المجانية: 10 طلبات في الدقيقة — نترك هامشاً
  return new FootballDataClient(env.FOOTBALL_DATA_KEY!, async () => {
    if (!(await rateLimit(env, 'fd', 8, 60))) throw new RetryLaterError();
  });
}

// ---------- ربط الفرق ----------

const keyOf = (t: Team) => teamKey(t.name, t.short);

// نتعلّم معرّفات فرق API-Football من كل بياناته (مفتاح الاسم ← المعرّف والشعار)
export async function recordTeams(env: Env, matches: Match[], now = Date.now()): Promise<void> {
  const seen = new Map<string, Team>();
  for (const m of matches) for (const t of [m.home, m.away]) if (t.id && t.id < FD_TEAM_OFFSET) seen.set(keyOf(t), t);
  if (!seen.size) return;
  const stmts = [...seen].map(([key, t]) =>
    env.DB.prepare(
      `INSERT INTO teams (key, af_id, name, logo, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(key) DO UPDATE SET af_id = excluded.af_id, name = excluded.name, logo = COALESCE(excluded.logo, teams.logo), updated_at = excluded.updated_at`,
    ).bind(key, t.id, t.name, t.logo ?? null, now),
  );
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

// يستبدل معرّفات فرق football-data.org بمعرّفات API-Football (إن عُرفت) حتى تعمل المفضلة والتنبيهات
async function teamIndex(env: Env, teams: Team[]): Promise<Map<string, { af_id: number; logo: string | null }>> {
  const keys = [...new Set(teams.filter((t) => t.id >= FD_TEAM_OFFSET).map(keyOf))];
  const out = new Map<string, { af_id: number; logo: string | null }>();
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT key, af_id, logo FROM teams WHERE key IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ key: string; af_id: number; logo: string | null }>();
    for (const r of results) out.set(r.key, r);
  }
  return out;
}

function remap(t: Team, idx: Map<string, { af_id: number; logo: string | null }>): Team {
  if (t.id < FD_TEAM_OFFSET) return t;
  const hit = idx.get(keyOf(t));
  return hit ? { ...t, id: hit.af_id, logo: hit.logo ?? t.logo } : t;
}

export async function mapMatches<T extends Match>(env: Env, list: T[]): Promise<T[]> {
  const idx = await teamIndex(env, list.flatMap((m) => [m.home, m.away]));
  return list.map((m) => ({ ...m, home: remap(m.home, idx), away: remap(m.away, idx) }));
}

export async function mapStandings(env: Env, s: Standings): Promise<Standings> {
  const idx = await teamIndex(env, s.groups.flatMap((g) => g.rows.map((r) => r.team)));
  return { ...s, groups: s.groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, team: remap(r.team, idx) })) })) };
}

// ---------- البيانات ----------

const today = (now: number) => utcDate(now);
const dayDiff = (date: string, now: number) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today(now)}T00:00:00Z`)) / DAY_MS);

export async function secondaryDay(env: Env, date: string, now = Date.now()) {
  const diff = dayDiff(date, now);
  const ttl = diff < -1 ? 12 * 3600 : diff <= 1 ? 30 * 60 : 2 * 3600;
  const r = await cached(env, `fd:date:${date}`, ttl, () => client(env).dayMatches(date), 60);
  return { ...r, value: await mapMatches(env, r.value) };
}

export async function secondaryStandings(env: Env, leagueId: number) {
  const r = await cached<Standings | null>(env, `fd:standings:${leagueId}`, 3600, () => client(env).standings(leagueId), 60);
  return { ...r, value: r.value ? await mapStandings(env, r.value) : null };
}

export async function secondaryLeagueMatches(env: Env, leagueId: number, now = Date.now()) {
  const from = utcDate(now - 21 * DAY_MS);
  const to = utcDate(now + 21 * DAY_MS);
  const r = await cached(env, `fd:league:${leagueId}`, 3600, () => client(env).competitionMatches(leagueId, from, to), 60);
  const all = await mapMatches(env, r.value);
  const last = all.filter((m) => m.status === 'finished').sort((a, b) => b.kickoff.localeCompare(a.kickoff)).slice(0, 10);
  const next = all.filter((m) => m.status !== 'finished' && m.status !== 'cancelled').sort((a, b) => a.kickoff.localeCompare(b.kickoff)).slice(0, 10);
  return { value: { last, next }, stale: r.stale };
}

export async function secondaryMatch(env: Env, id: number) {
  const r = await cached<MatchDetails | null>(
    env,
    `fd:match:${id}`,
    (m) => (m?.status === 'finished' ? 86400 : 600),
    () => client(env).match(id - FD_MATCH_OFFSET),
    60,
  );
  return { ...r, value: r.value ? (await mapMatches(env, [r.value]))[0] : null };
}
