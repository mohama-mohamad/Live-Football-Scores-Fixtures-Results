// مزوّد بيانات تجريبي: يولّد مباريات واقعية بشكل حتمي (نفس النتيجة في كل مرة)
// وتتقدّم المباريات مع الوقت الحقيقي (أهداف، بطاقات، استراحة، نهاية)
// حتى يمكن تجربة التطبيق والتنبيهات كاملةً دون مفتاح API.
import type { Lineup, Match, MatchDetails, MatchEvent, MatchStatus, StatPair, Standings } from '../../../shared/types';
import { leagueConfig } from '../../../shared/leagues';
import type { Provider } from './types';

const POOLS: { id: number; name: string; teams: string[] }[] = [
  { id: 307, name: 'Saudi Pro League', teams: ['Al-Hilal', 'Al-Nassr', 'Al-Ittihad', 'Al-Ahli', 'Al-Shabab', 'Al-Ettifaq', 'Al-Taawoun', 'Al-Fateh', 'Al-Qadisiyah', 'Damac', 'Al-Khaleej', 'Al-Riyadh'] },
  { id: 39, name: 'Premier League', teams: ['Arsenal', 'Liverpool', 'Manchester City', 'Chelsea', 'Manchester United', 'Tottenham', 'Newcastle', 'Aston Villa', 'Brighton', 'West Ham', 'Everton', 'Fulham'] },
  { id: 140, name: 'La Liga', teams: ['Real Madrid', 'Barcelona', 'Atletico Madrid', 'Athletic Club', 'Real Sociedad', 'Villarreal', 'Real Betis', 'Sevilla', 'Valencia', 'Girona'] },
  { id: 2, name: 'UEFA Champions League', teams: ['Real Madrid', 'Manchester City', 'Bayern Munich', 'Paris Saint Germain', 'Inter', 'Barcelona', 'Liverpool', 'Arsenal', 'Borussia Dortmund', 'Benfica'] },
  { id: 233, name: 'Egyptian Premier League', teams: ['Al Ahly', 'Zamalek', 'Pyramids', 'Al Masry', 'Ismaily', 'Ceramica Cleopatra', 'Enppi', 'Smouha', 'ZED', 'Future'] },
  { id: 135, name: 'Serie A', teams: ['Inter', 'AC Milan', 'Juventus', 'Napoli', 'AS Roma', 'Lazio', 'Atalanta', 'Fiorentina', 'Bologna', 'Torino'] },
  { id: 78, name: 'Bundesliga', teams: ['Bayern Munich', 'Borussia Dortmund', 'Bayer Leverkusen', 'RB Leipzig', 'Eintracht Frankfurt', 'VfB Stuttgart', 'SC Freiburg', 'VfL Wolfsburg'] },
  { id: 61, name: 'Ligue 1', teams: ['Paris Saint Germain', 'Marseille', 'Lyon', 'Monaco', 'Lille', 'Nice', 'Lens', 'Rennes'] },
];

const PLAYERS = [
  'سالم الدوسري', 'محمد كنو', 'ياسر الشهراني', 'سعود عبدالحميد', 'فراس البريكان', 'عبدالله الحمدان', 'محمد العويس', 'علي البليهي',
  'محمد صلاح', 'عمر مرموش', 'أشرف حكيمي', 'يوسف النصيري', 'رياض محرز', 'حكيم زياش', 'سفيان أمرابط', 'إمام عاشور',
  'أحمد سيد زيزو', 'مصطفى محمد', 'كريم بنزيما', 'نيمار', 'كريستيانو رونالدو', 'ساديو ماني', 'مالكوم', 'روبن نيفيز',
  'إسماعيل بن ناصر', 'محمد عبدالمنعم', 'حمدي فتحي', 'أكرم عفيف', 'المعز علي', 'عمر السومة', 'هتان باهبري', 'نواف العقيدي',
];
const FORMATIONS = ['4-3-3', '4-2-3-1', '3-5-2', '4-4-2', '3-4-3'];

// مولّد أرقام عشوائية حتمي
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function hash(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DAY_MS = 86_400_000;
const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const dayString = (idx: number) => new Date(idx * DAY_MS).toISOString().slice(0, 10);

interface Slot {
  day: number;
  league: number; // فهرس في POOLS
  slot: number;
  k: number;
}

function slotsForDay(day: number): Slot[] {
  const out: Slot[] = [];
  POOLS.forEach((_, league) => {
    let slot = 0;
    for (let hour = league % 4; hour < 24; hour += 4, slot++) {
      const count = 1 + (hash(day, league, slot) % 2);
      for (let k = 0; k < count; k++) out.push({ day, league, slot, k });
    }
  });
  return out;
}

const idOf = (s: Slot) => s.day * 1000 + s.league * 100 + s.slot * 2 + s.k;
const slotOf = (id: number): Slot => ({
  day: Math.floor(id / 1000),
  league: Math.floor((id % 1000) / 100),
  slot: Math.floor((id % 100) / 2),
  k: id % 2,
});

// تحويل دقيقة المباراة إلى دقائق حقيقية منذ صافرة البداية
const realElapsed = (minute: number) => (minute <= 45 ? minute - 1 : 62 + (minute - 46));

export class MockProvider implements Provider {
  name = 'mock';
  limited = false;

  constructor(private now: () => number = Date.now) {}

  private build(s: Slot, details = false): MatchDetails | null {
    const pool = POOLS[s.league];
    if (!pool || s.slot > 5 || s.k > 1) return null;
    const r = rng(hash(s.day, s.league, s.slot, s.k, 7));
    const hour = (s.league % 4) + s.slot * 4;
    const minuteOfHour = (s.league * 15) % 60;
    const kickoff = s.day * DAY_MS + hour * 3_600_000 + minuteOfHour * 60_000;

    // ترتيب عشوائي ثابت لفرق هذا التوقيت: المباراة k تأخذ الفريقين 2k و 2k+1
    // (فلا يلعب فريق مباراتين في نفس الوقت)
    const n = pool.teams.length;
    const pr = rng(hash(s.day, s.league, s.slot, 3));
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(pr() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const hi = perm[s.k * 2];
    const awayIdx = perm[s.k * 2 + 1];
    const team = (i: number) => ({ id: pool.id * 1000 + i, name: pool.teams[i] });
    const home = team(hi);
    const away = team(awayIdx);

    const id = idOf(s);
    const elapsed = (this.now() - kickoff) / 60_000;
    const postponed = hash(id, 99) % 37 === 0;

    let status: MatchStatus;
    let minute: number | null = null;
    if (postponed) status = 'postponed';
    else if (elapsed < 0) status = 'scheduled';
    else if (elapsed < 47) {
      status = 'live';
      minute = Math.min(45, Math.floor(elapsed) + 1);
    } else if (elapsed < 62) {
      status = 'halftime';
      minute = 45;
    } else if (elapsed < 111) {
      status = 'live';
      minute = Math.min(90, 46 + Math.floor(elapsed - 62));
    } else {
      status = 'finished';
      minute = 90;
    }

    // توليد كل أحداث المباراة ثم إظهار ما حدث حتى الآن
    const all: MatchEvent[] = [];
    const pick = () => PLAYERS[Math.floor(r() * PLAYERS.length)];
    const goals = [0, 1, 1, 2, 2, 2, 3, 3, 4, 5][Math.floor(r() * 10)];
    for (let g = 0; g < goals; g++) {
      const side = r() < 0.55 ? home : away;
      const x = r();
      all.push({
        minute: 1 + Math.floor(r() * 90),
        type: x < 0.1 ? 'penalty_goal' : x < 0.14 ? 'own_goal' : 'goal',
        teamId: side.id,
        player: pick(),
        assist: x > 0.5 ? pick() : undefined,
      });
    }
    const yellows = 2 + Math.floor(r() * 4);
    for (let y = 0; y < yellows; y++) all.push({ minute: 10 + Math.floor(r() * 80), type: 'yellow', teamId: r() < 0.5 ? home.id : away.id, player: pick() });
    if (r() < 0.2) all.push({ minute: 30 + Math.floor(r() * 60), type: 'red', teamId: r() < 0.5 ? home.id : away.id, player: pick() });
    for (const t of [home, away]) {
      const subs = 3 + Math.floor(r() * 3);
      for (let i = 0; i < subs; i++) all.push({ minute: 55 + Math.floor(r() * 35), type: 'sub', teamId: t.id, player: pick(), assist: pick() });
    }
    all.sort((a, b) => a.minute - b.minute);

    const realNow = status === 'finished' ? Infinity : status === 'scheduled' || status === 'postponed' ? -Infinity : elapsed;
    const events = all.filter((e) => realElapsed(e.minute) < realNow);
    const isGoal = (e: MatchEvent) => e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'own_goal';
    const scored = (t: number) => events.filter((e) => isGoal(e) && e.teamId === t).length;
    const started = status !== 'scheduled' && status !== 'postponed';

    const cfg = leagueConfig(pool.id);
    const m: MatchDetails = {
      id,
      league: { id: pool.id, name: pool.name, country: cfg?.country, season: 2026 },
      round: `الجولة ${1 + (s.day % 34)}`,
      kickoff: new Date(kickoff).toISOString(),
      status,
      minute,
      home,
      away,
      score: started ? { home: scored(home.id), away: scored(away.id) } : { home: null, away: null },
      venue: `ملعب ${['الملك فهد', 'الأمير فيصل', 'القاهرة الدولي', 'الإنماء', 'المدينة'][hash(hi, pool.id) % 5]}`,
      referee: ['محمد الهويش', 'فيصل البلوي', 'أنتوني تايلور', 'ماثيو لاهوز'][hash(id) % 4],
      events,
    };

    if (details && started) {
      const progress = Math.min(1, (minute ?? 0) / 90);
      const pos = 35 + Math.floor(r() * 31);
      const sc = (max: number) => Math.round(r() * max * progress);
      const stats: StatPair[] = [
        { key: 'possession', home: `${pos}%`, away: `${100 - pos}%` },
        { key: 'shots_total', home: sc(18), away: sc(14) },
        { key: 'shots_on', home: sc(8), away: sc(6) },
        { key: 'corners', home: sc(9), away: sc(7) },
        { key: 'fouls', home: sc(15), away: sc(15) },
        { key: 'offsides', home: sc(4), away: sc(4) },
        { key: 'yellow', home: events.filter((e) => e.type === 'yellow' && e.teamId === home.id).length, away: events.filter((e) => e.type === 'yellow' && e.teamId === away.id).length },
        { key: 'saves', home: sc(6), away: sc(6) },
        { key: 'pass_accuracy', home: `${75 + Math.floor(r() * 18)}%`, away: `${72 + Math.floor(r() * 18)}%` },
      ];
      m.stats = stats;
    }
    if (details) {
      const lineup = (t: { id: number }): Lineup => {
        const used = new Set<string>();
        const take = () => {
          for (let i = 0; i < 50; i++) {
            const p = pick();
            if (!used.has(p)) {
              used.add(p);
              return p;
            }
          }
          return pick();
        };
        return {
          teamId: t.id,
          formation: FORMATIONS[Math.floor(r() * FORMATIONS.length)],
          coach: ['جورجي جيسوس', 'ستيفانو بيولي', 'مارسيل كولر', 'بيب غوارديولا', 'كارلو أنشيلوتي'][Math.floor(r() * 5)],
          startXI: Array.from({ length: 11 }, (_, i) => ({ name: take(), number: i + 1, pos: i === 0 ? 'G' : i < 5 ? 'D' : i < 8 ? 'M' : 'F' })),
          subs: Array.from({ length: 7 }, (_, i) => ({ name: take(), number: 12 + i })),
        };
      };
      m.lineups = [lineup(home), lineup(away)];
    }
    return m;
  }

  private slim(m: MatchDetails | null): Match | null {
    if (!m) return null;
    const { stats: _s, lineups: _l, ...rest } = m;
    return rest;
  }

  async matchesByUtcDate(date: string): Promise<Match[]> {
    return slotsForDay(dayIndex(date))
      .map((s) => this.slim(this.build(s)))
      .filter((m): m is Match => !!m);
  }

  async live(): Promise<Match[]> {
    const today = Math.floor(this.now() / DAY_MS);
    const all = [...(await this.matchesByUtcDate(dayString(today - 1))), ...(await this.matchesByUtcDate(dayString(today)))];
    return all.filter((m) => m.status === 'live' || m.status === 'halftime');
  }

  async matchesByIds(ids: number[]): Promise<Match[]> {
    return ids.map((id) => this.slim(this.build(slotOf(id)))).filter((m): m is Match => !!m);
  }

  async match(id: number): Promise<MatchDetails | null> {
    return this.build(slotOf(id), true);
  }

  async standings(leagueId: number): Promise<Standings | null> {
    const pool = POOLS.find((p) => p.id === leagueId);
    if (!pool) return null;
    const r = rng(hash(leagueId, Math.floor(this.now() / DAY_MS)));
    const played = 8 + (Math.floor(this.now() / DAY_MS) % 5);
    const rows = pool.teams.map((name, i) => {
      const win = Math.floor(r() * (played + 1));
      const draw = Math.floor(r() * (played - win + 1));
      const lose = played - win - draw;
      const goalsFor = win * 2 + draw + Math.floor(r() * 5);
      const goalsAgainst = lose * 2 + draw + Math.floor(r() * 4);
      const form = Array.from({ length: 5 }, () => 'WDL'[Math.floor(r() * 3)]).join('');
      return { rank: 0, team: { id: pool.id * 1000 + i, name }, played, win, draw, lose, goalsFor, goalsAgainst, goalDiff: goalsFor - goalsAgainst, points: win * 3 + draw, form };
    });
    rows.sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);
    rows.forEach((row, i) => (row.rank = i + 1));
    return { league: { id: pool.id, name: pool.name, season: 2026 }, groups: [{ name: pool.name, rows }] };
  }

  async leagueMatches(leagueId: number): Promise<{ last: Match[]; next: Match[] }> {
    const league = POOLS.findIndex((p) => p.id === leagueId);
    if (league < 0) return { last: [], next: [] };
    const today = Math.floor(this.now() / DAY_MS);
    const forDay = (d: number) =>
      slotsForDay(d)
        .filter((s) => s.league === league)
        .map((s) => this.slim(this.build(s)))
        .filter((m): m is Match => !!m);
    const last: Match[] = [];
    const next: Match[] = [];
    for (let d = today; d >= today - 3 && last.length < 10; d--) last.push(...forDay(d).filter((m) => m.status === 'finished').reverse());
    for (let d = today; d <= today + 3 && next.length < 10; d++) next.push(...forDay(d).filter((m) => m.status === 'scheduled'));
    return { last: last.slice(0, 10), next: next.slice(0, 10) };
  }
}
