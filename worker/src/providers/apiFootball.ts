// مزوّد API-Football (api-sports.io) — https://www.api-football.com/documentation-v3
import type { EventType, Lineup, Match, MatchDetails, MatchEvent, MatchStatus, StatPair, Standings } from '../../../shared/types';
import { LEAGUE_IDS, LEAGUES } from '../../../shared/leagues';
import { ProviderError, type Provider } from './types';

const BASE = 'https://v3.football.api-sports.io';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const STATUS: Record<string, MatchStatus> = {
  TBD: 'scheduled',
  NS: 'scheduled',
  '1H': 'live',
  '2H': 'live',
  ET: 'live',
  LIVE: 'live',
  HT: 'halftime',
  BT: 'halftime',
  P: 'penalties',
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  PST: 'postponed',
  CANC: 'cancelled',
  ABD: 'cancelled',
  AWD: 'finished',
  WO: 'finished',
  SUSP: 'cancelled',
  INT: 'cancelled',
};

const STAT_KEYS: Record<string, string> = {
  'Ball Possession': 'possession',
  'Total Shots': 'shots_total',
  'Shots on Goal': 'shots_on',
  'Shots off Goal': 'shots_off',
  'Blocked Shots': 'shots_blocked',
  'Corner Kicks': 'corners',
  Offsides: 'offsides',
  Fouls: 'fouls',
  'Yellow Cards': 'yellow',
  'Red Cards': 'red',
  'Goalkeeper Saves': 'saves',
  'Total passes': 'passes',
  'Passes %': 'pass_accuracy',
  expected_goals: 'xg',
};

function eventType(e: Json): EventType | null {
  const type = String(e.type ?? '').toLowerCase();
  const detail = String(e.detail ?? '').toLowerCase();
  if (type === 'goal') {
    if (detail.includes('own')) return 'own_goal';
    if (detail.includes('missed')) return 'missed_penalty';
    if (detail.includes('penalty')) return 'penalty_goal';
    return 'goal';
  }
  if (type === 'card') return detail.includes('red') || detail.includes('second yellow') ? 'red' : 'yellow';
  if (type === 'subst') return 'sub';
  if (type === 'var') return 'var';
  return null;
}

function normEvents(list: Json[] | undefined): MatchEvent[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out: MatchEvent[] = [];
  for (const e of list) {
    const t = eventType(e);
    if (!t) continue;
    out.push({
      minute: Number(e.time?.elapsed ?? 0),
      extra: e.time?.extra ?? undefined,
      type: t,
      teamId: Number(e.team?.id ?? 0),
      // في التبديلات: player = الخارج، assist = الداخل
      player: e.player?.name ?? undefined,
      assist: e.assist?.name ?? undefined,
      detail: e.detail ?? undefined,
    });
  }
  return out;
}

export function normFixture(f: Json): MatchDetails {
  const short = String(f.fixture?.status?.short ?? '');
  const status = STATUS[short] ?? 'unknown';
  const m: MatchDetails = {
    id: Number(f.fixture.id),
    league: {
      id: Number(f.league?.id),
      name: String(f.league?.name ?? ''),
      country: f.league?.country ?? undefined,
      logo: f.league?.logo ?? undefined,
      season: f.league?.season ?? undefined,
    },
    round: f.league?.round ?? undefined,
    kickoff: new Date(Number(f.fixture.timestamp) * 1000).toISOString(),
    status,
    statusShort: short,
    minute: f.fixture?.status?.elapsed ?? null,
    home: { id: Number(f.teams?.home?.id), name: String(f.teams?.home?.name ?? ''), logo: f.teams?.home?.logo },
    away: { id: Number(f.teams?.away?.id), name: String(f.teams?.away?.name ?? ''), logo: f.teams?.away?.logo },
    score: { home: f.goals?.home ?? null, away: f.goals?.away ?? null },
    venue: [f.fixture?.venue?.name, f.fixture?.venue?.city].filter(Boolean).join('، ') || undefined,
    referee: f.fixture?.referee ?? undefined,
    events: normEvents(f.events),
  };
  const pen = f.score?.penalty;
  if (pen && (pen.home != null || pen.away != null)) m.penalties = { home: pen.home, away: pen.away };

  if (Array.isArray(f.statistics) && f.statistics.length === 2) {
    const [h, a] = f.statistics;
    const byType = (side: Json) => new Map<string, Json>((side.statistics ?? []).map((s: Json) => [s.type, s.value]));
    const hm = byType(h);
    const am = byType(a);
    const stats: StatPair[] = [];
    for (const [type, key] of Object.entries(STAT_KEYS)) {
      if (hm.has(type) || am.has(type)) stats.push({ key, home: hm.get(type) ?? null, away: am.get(type) ?? null });
    }
    m.stats = stats;
  }

  if (Array.isArray(f.lineups) && f.lineups.length) {
    m.lineups = f.lineups.map(
      (l: Json): Lineup => ({
        teamId: Number(l.team?.id),
        formation: l.formation ?? undefined,
        coach: l.coach?.name ?? undefined,
        startXI: (l.startXI ?? []).map((p: Json) => ({ name: p.player?.name, number: p.player?.number, pos: p.player?.pos })),
        subs: (l.substitutes ?? []).map((p: Json) => ({ name: p.player?.name, number: p.player?.number, pos: p.player?.pos })),
      }),
    );
  }
  return m;
}

// القوائم لا تحتاج الإحصائيات والتشكيلات (لتقليل حجم التخزين)
function slim(m: MatchDetails): Match {
  const { stats: _s, lineups: _l, ...rest } = m;
  return rest;
}

function parseEnvelope(text: string): Json[] {
  let body: Json;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ProviderError('رد غير صالح من API-Football');
  }
  const errors = body.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
  if (hasErrors) throw new ProviderError(`API-Football: ${Object.values(errors).join(' | ')}`);
  return Array.isArray(body.response) ? body.response : [];
}

const MARKER = '{"fixture":';
const tracked = (list: Json[]) => list.filter((f) => LEAGUE_IDS.has(Number(f.league?.id)));

// يستخرج مباريات الدوريات المتابَعة من رد كبير دون تحليل النص كاملاً:
// نقسم النص عند بداية كل مباراة، نقرأ معرّف الدوري، ونحلّل المباريات المطلوبة فقط.
// تحليل 1.5MB كاملاً يقارب حد المعالجة في خطة Cloudflare المجانية (10ms).
export function extractTracked(text: string): Json[] {
  const start = text.indexOf('"response":[');
  if (text.length < 200_000 || start < 0) return tracked(parseEnvelope(text));
  const parts = text.slice(start + 12).split(MARKER);
  const out: Json[] = [];
  try {
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const k = p.indexOf('"league":{"id":');
      if (k < 0) throw new Error('format');
      if (!LEAGUE_IDS.has(parseInt(p.slice(k + 15, k + 27), 10))) continue;
      const last = i === parts.length - 1;
      // آخر مباراة يتبعها "]" ثم بقية الغلاف؛ غيرها تنتهي بفاصلة
      const body = last ? p.slice(0, p.lastIndexOf(']')) : p.replace(/,\s*$/, '');
      out.push(JSON.parse(MARKER + body));
    }
  } catch {
    // صيغة غير متوقعة: نعود للتحليل الكامل
    return tracked(parseEnvelope(text));
  }
  return out;
}

export class ApiFootballProvider implements Provider {
  name = 'api-football';
  limited = true;

  constructor(
    private key: string,
    private hooks: {
      // يُستدعى قبل كل طلب فعلي (لاحتساب الحد اليومي)
      onRequest?: () => Promise<void>;
      // ذاكرة مؤقتة للقيم التي نادراً ما تتغير (مثل الموسم الحالي)
      memo?: <T>(key: string, ttlSec: number, fn: () => Promise<T>) => Promise<T>;
    } = {},
    // ملاحظة: في Workers يجب ألا يُستدعى fetch كدالة على كائن آخر (Illegal invocation)، لذلك نغلّفه
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async fetchText(path: string, params: Record<string, string | number>): Promise<string> {
    await this.hooks.onRequest?.();
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await this.fetcher(url.toString(), { headers: { 'x-apisports-key': this.key } });
    // مركز Cloudflare الذي خرج منه الطلب (آخر 3 أحرف من cf-ray)
    this.lastColo = (res.headers.get('cf-ray') ?? '').split('-')[1] ?? '';
    if (!res.ok) throw new ProviderError(`API-Football HTTP ${res.status}`);
    const text = await res.text();
    // عند رفض الطلب نضيف ترويسات الحدود للرسالة (للتشخيص)
    if (text.length < 2000 && text.includes('"errors"') && !text.includes('"errors":[]')) {
      const h = (k: string) => res.headers.get(k) ?? '-';
      this.lastLimits = `limit/min=${h('x-ratelimit-limit')} left/min=${h('x-ratelimit-remaining')} left/day=${h('x-ratelimit-requests-remaining')} cf-ray=${h('cf-ray')}`;
    }
    return text;
  }

  // آخر ترويسات حدود عند الرفض (تُضاف لرسالة الخطأ)
  lastLimits = '';
  lastColo = '';

  private async get(path: string, params: Record<string, string | number>): Promise<Json[]> {
    const text = await this.fetchText(path, params);
    try {
      return parseEnvelope(text);
    } catch (e) {
      if (e instanceof ProviderError && this.lastLimits) throw new ProviderError(`${e.message} [${this.lastLimits}]`, e.status);
      throw e;
    }
  }

  async matchesByUtcDate(date: string): Promise<Match[]> {
    // قائمة اليوم كبيرة جداً (~1.5MB لكل دوريات العالم): نستخرج دورياتنا فقط دون تحليل الكل
    const text = await this.fetchText('/fixtures', { date, timezone: 'UTC' });
    return extractTracked(text).map((f) => slim(normFixture(f)));
  }

  async live(): Promise<Match[]> {
    const ids = LEAGUES.map((l) => l.id).join('-');
    const list = await this.get('/fixtures', { live: ids });
    return list.map((f) => slim(normFixture(f)));
  }

  async matchesByIds(ids: number[]): Promise<Match[]> {
    const out: Match[] = [];
    for (let i = 0; i < ids.length; i += 20) {
      const list = await this.get('/fixtures', { ids: ids.slice(i, i + 20).join('-') });
      out.push(...list.map((f) => slim(normFixture(f))));
    }
    return out;
  }

  async match(id: number): Promise<MatchDetails | null> {
    const list = await this.get('/fixtures', { id });
    return list[0] ? normFixture(list[0]) : null;
  }

  private currentSeason(leagueId: number): Promise<number> {
    const load = () => this.loadSeason(leagueId);
    return this.hooks.memo ? this.hooks.memo(`season:${leagueId}`, 86400, load) : load();
  }

  private async loadSeason(leagueId: number): Promise<number> {
    const list = await this.get('/leagues', { id: leagueId, current: 'true' });
    const season = list[0]?.seasons?.find((s: Json) => s.current)?.year ?? list[0]?.seasons?.[0]?.year;
    if (!season) throw new ProviderError('لم يتم العثور على الموسم الحالي', 404);
    return Number(season);
  }

  async standings(leagueId: number): Promise<Standings | null> {
    const season = await this.currentSeason(leagueId);
    const list = await this.get('/standings', { league: leagueId, season });
    const lg = list[0]?.league;
    if (!lg) return null;
    return {
      league: { id: lg.id, name: lg.name, country: lg.country, logo: lg.logo, season: lg.season },
      groups: (lg.standings ?? []).map((rows: Json[], i: number) => ({
        name: rows[0]?.group ?? `المجموعة ${i + 1}`,
        rows: rows.map((r: Json) => ({
          rank: r.rank,
          team: { id: r.team?.id, name: r.team?.name, logo: r.team?.logo },
          played: r.all?.played ?? 0,
          win: r.all?.win ?? 0,
          draw: r.all?.draw ?? 0,
          lose: r.all?.lose ?? 0,
          goalsFor: r.all?.goals?.for ?? 0,
          goalsAgainst: r.all?.goals?.against ?? 0,
          goalDiff: r.goalsDiff ?? 0,
          points: r.points ?? 0,
          form: r.form ?? undefined,
          group: r.group ?? undefined,
        })),
      })),
    };
  }

  async leagueMatches(leagueId: number): Promise<{ last: Match[]; next: Match[] }> {
    const season = await this.currentSeason(leagueId);
    const [last, next] = await Promise.all([
      this.get('/fixtures', { league: leagueId, season, last: 10 }),
      this.get('/fixtures', { league: leagueId, season, next: 10 }),
    ]);
    return { last: last.map((f) => slim(normFixture(f))), next: next.map((f) => slim(normFixture(f))) };
  }
}
