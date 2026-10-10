// مزوّد ثانٍ: football-data.org (v4) — https://www.football-data.org/documentation/api
// يُستخدم لما لا تتيحه خطة API-Football المجانية: جداول الترتيب، ومباريات ما بعد الغد.
// المعرّفات تختلف عن API-Football، لذلك:
// - معرّف المباراة = FD_MATCH_OFFSET + المعرّف الأصلي (لتمييزها عند فتح التفاصيل)
// - معرّف الفريق = FD_TEAM_OFFSET + المعرّف الأصلي، ثم يستبدله الخادم بمعرّف API-Football إن عرفه (بالاسم)
import type { League, Match, MatchDetails, MatchStatus, Standings } from '../../../shared/types';
import { SECONDARY_MATCH_OFFSET, SECONDARY_TEAM_OFFSET } from '../../../shared/teams';
import { ProviderError } from './types';

const BASE = 'https://api.football-data.org/v4';
export const FD_MATCH_OFFSET = SECONDARY_MATCH_OFFSET;
export const FD_TEAM_OFFSET = SECONDARY_TEAM_OFFSET;

// رموز بطولات football-data.org ← معرّفات API-Football المستخدمة في التطبيق
export const FD_CODES: Record<number, string> = { 39: 'PL', 140: 'PD', 135: 'SA', 78: 'BL1', 61: 'FL1', 2: 'CL', 4: 'EC', 1: 'WC' };
const LEAGUE_BY_CODE = Object.fromEntries(Object.entries(FD_CODES).map(([id, code]) => [code, Number(id)]));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const STATUS: Record<string, MatchStatus> = {
  SCHEDULED: 'scheduled',
  TIMED: 'scheduled',
  IN_PLAY: 'live',
  LIVE: 'live',
  EXTRA_TIME: 'live',
  PAUSED: 'halftime',
  PENALTY_SHOOTOUT: 'penalties',
  FINISHED: 'finished',
  AWARDED: 'finished',
  POSTPONED: 'postponed',
  SUSPENDED: 'cancelled',
  CANCELLED: 'cancelled',
};

const STAGES: Record<string, string> = {
  LEAGUE_STAGE: 'مرحلة الدوري',
  GROUP_STAGE: 'دور المجموعات',
  PLAYOFFS: 'الملحق',
  LAST_32: 'دور الـ32',
  LAST_16: 'دور الـ16',
  QUARTER_FINALS: 'ربع النهائي',
  SEMI_FINALS: 'نصف النهائي',
  FINAL: 'النهائي',
  THIRD_PLACE: 'تحديد المركز الثالث',
};

const team = (t: Json) => ({
  id: FD_TEAM_OFFSET + Number(t?.id ?? 0),
  name: String(t?.name ?? t?.shortName ?? ''),
  short: t?.shortName ?? undefined,
  logo: t?.crest ?? undefined,
});

// الخطة المجانية لا تُرجع الدقيقة: نقدّرها من وقت البداية (شوط أول 45 + استراحة ~15 دقيقة)
export function estimateMinute(status: MatchStatus, kickoff: string, now = Date.now()): number | null {
  if (status === 'halftime') return 45;
  if (status !== 'live') return null;
  const elapsed = Math.floor((now - Date.parse(kickoff)) / 60_000);
  if (elapsed < 0) return 1;
  if (elapsed <= 47) return Math.max(1, elapsed);
  if (elapsed < 62) return 45; // بدل ضائع طويل في الشوط الأول، أو بداية الثاني
  return Math.min(90, elapsed - 17);
}

export function normFdMatch(m: Json, now = Date.now()): MatchDetails | null {
  const leagueId = LEAGUE_BY_CODE[m?.competition?.code];
  if (!leagueId) return null;
  const status = STATUS[m.status] ?? 'unknown';
  const started = status !== 'scheduled' && status !== 'postponed' && status !== 'unknown';
  const ft = m.score?.fullTime ?? {};
  const pen = m.score?.penalties;
  const league: League = { id: leagueId, name: m.competition?.name ?? '', logo: m.competition?.emblem ?? undefined, season: m.season?.startDate ? Number(String(m.season.startDate).slice(0, 4)) : undefined };
  return {
    id: FD_MATCH_OFFSET + Number(m.id),
    league,
    round: m.matchday ? `الجولة ${m.matchday}` : STAGES[m.stage] ?? undefined,
    kickoff: new Date(m.utcDate).toISOString(),
    status,
    statusShort: m.status,
    minute: typeof m.minute === 'number' ? m.minute : estimateMinute(status, m.utcDate, now),
    home: team(m.homeTeam),
    away: team(m.awayTeam),
    score: started ? { home: ft.home ?? 0, away: ft.away ?? 0 } : { home: null, away: null },
    penalties: pen && (pen.home != null || pen.away != null) ? { home: pen.home, away: pen.away } : undefined,
    venue: m.venue ?? undefined,
    referee: m.referees?.[0]?.name ?? undefined,
  };
}

const isMatch = (m: MatchDetails | null): m is MatchDetails => !!m;

export class FootballDataClient {
  constructor(
    private key: string,
    // يُستدعى قبل كل طلب (لاحترام حد الطلبات في الدقيقة)
    private beforeRequest: () => Promise<void> = async () => {},
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async get(path: string): Promise<Json> {
    await this.beforeRequest();
    const res = await this.fetcher(BASE + path, { headers: { 'X-Auth-Token': this.key, 'User-Agent': 'koora-live/1.0', Accept: 'application/json' } });
    const body: Json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(`football-data.org: ${body?.message ?? `HTTP ${res.status}`}`, res.status === 429 ? 503 : 502);
    return body;
  }

  // مباريات يوم UTC واحد في البطولات المدعومة
  async dayMatches(date: string): Promise<Match[]> {
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const body = await this.get(`/matches?dateFrom=${date}&dateTo=${next}`);
    return (body.matches ?? [])
      .filter((m: Json) => String(m.utcDate).slice(0, 10) === date)
      .map((x: Json) => normFdMatch(x))
      .filter(isMatch);
  }

  // المباريات الجارية الآن في البطولات المدعومة
  async live(): Promise<Match[]> {
    const body = await this.get('/matches?status=IN_PLAY,PAUSED,LIVE');
    return (body.matches ?? []).map((x: Json) => normFdMatch(x)).filter(isMatch);
  }

  // مباريات بمعرّفاتنا (المُزاحة) — لمعرفة نتيجة مباراة اختفت من قائمة المباشر
  async matchesByIds(ids: number[]): Promise<Match[]> {
    const raw = ids.map((id) => id - FD_MATCH_OFFSET).filter((id) => id > 0);
    if (!raw.length) return [];
    const body = await this.get(`/matches?ids=${raw.join(',')}`);
    return (body.matches ?? []).map((x: Json) => normFdMatch(x)).filter(isMatch);
  }

  async competitionMatches(leagueId: number, from: string, to: string): Promise<Match[]> {
    const code = FD_CODES[leagueId];
    if (!code) return [];
    const body = await this.get(`/competitions/${code}/matches?dateFrom=${from}&dateTo=${to}`);
    return (body.matches ?? []).map((x: Json) => normFdMatch(x)).filter(isMatch);
  }

  async match(fdId: number): Promise<MatchDetails | null> {
    const body = await this.get(`/matches/${fdId}`);
    return normFdMatch(body);
  }

  async standings(leagueId: number): Promise<Standings | null> {
    const code = FD_CODES[leagueId];
    if (!code) return null;
    const body = await this.get(`/competitions/${code}/standings`);
    const groups = (body.standings ?? [])
      .filter((s: Json) => !s.type || s.type === 'TOTAL')
      .map((s: Json, i: number) => ({
        name: s.group ? String(s.group).replace(/^GROUP_/, 'المجموعة ') : body.competition?.name ?? `المجموعة ${i + 1}`,
        rows: (s.table ?? []).map((r: Json) => ({
          rank: r.position,
          team: team(r.team),
          played: r.playedGames ?? 0,
          win: r.won ?? 0,
          draw: r.draw ?? 0,
          lose: r.lost ?? 0,
          goalsFor: r.goalsFor ?? 0,
          goalsAgainst: r.goalsAgainst ?? 0,
          goalDiff: r.goalDifference ?? 0,
          points: r.points ?? 0,
          form: r.form ? String(r.form).replace(/,/g, '') : undefined,
        })),
      }));
    if (!groups.length) return null;
    return {
      league: { id: leagueId, name: body.competition?.name ?? '', logo: body.competition?.emblem, season: body.season?.startDate ? Number(String(body.season.startDate).slice(0, 4)) : undefined },
      groups,
    };
  }
}
