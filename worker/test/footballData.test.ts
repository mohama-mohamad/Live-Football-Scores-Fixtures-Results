import { describe, it, expect } from 'vitest';
import { FootballDataClient, FD_MATCH_OFFSET, FD_TEAM_OFFSET, normFdMatch } from '../src/providers/footballData';
import { teamKey } from '../../shared/teams';
import { wants } from '../src/service';
import { diffMatch } from '../src/notify';

const fdMatch = {
  id: 558579,
  utcDate: '2026-10-12T16:30:00Z',
  status: 'TIMED',
  matchday: 6,
  stage: 'REGULAR_SEASON',
  competition: { code: 'SA', name: 'Serie A', emblem: 'sa.png' },
  season: { startDate: '2026-08-23' },
  homeTeam: { id: 102, name: 'Atalanta BC', shortName: 'Atalanta', tla: 'ATA', crest: 'ata.png' },
  awayTeam: { id: 454, name: 'Venezia FC', shortName: 'Venezia FC', tla: 'VEN', crest: 'ven.png' },
  score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null }, halfTime: { home: null, away: null } },
  referees: [],
};

describe('football-data.org normalization', () => {
  it('maps matches to the shared model with offset ids and app league ids', () => {
    const m = normFdMatch(fdMatch)!;
    expect(m.id).toBe(FD_MATCH_OFFSET + 558579);
    expect(m.league.id).toBe(135);
    expect(m.status).toBe('scheduled');
    expect(m.score).toEqual({ home: null, away: null });
    expect(m.home).toMatchObject({ id: FD_TEAM_OFFSET + 102, name: 'Atalanta BC', short: 'Atalanta', logo: 'ata.png' });
    expect(m.round).toBe('الجولة 6');
    const live = normFdMatch({ ...fdMatch, status: 'IN_PLAY', score: { fullTime: { home: 2, away: 1 } } })!;
    expect(live.status).toBe('live');
    expect(live.score).toEqual({ home: 2, away: 1 });
    expect(normFdMatch({ ...fdMatch, competition: { code: 'DED' } })).toBeNull();
  });

  it('fetches a single UTC day and maps standings', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.includes('/standings')) {
        return new Response(JSON.stringify({
          competition: { name: 'Premier League' }, season: { startDate: '2026-08-21' },
          standings: [
            { type: 'TOTAL', table: [{ position: 1, team: { id: 65, name: 'Manchester City FC', shortName: 'Man City' }, playedGames: 5, won: 5, draw: 0, lost: 0, points: 15, goalsFor: 13, goalsAgainst: 5, goalDifference: 8, form: 'W,W,W' }] },
            { type: 'HOME', table: [] },
          ],
        }));
      }
      return new Response(JSON.stringify({ matches: [fdMatch, { ...fdMatch, id: 2, utcDate: '2026-10-13T00:30:00Z' }] }));
    }) as unknown as typeof fetch;
    const c = new FootballDataClient('k', async () => {}, fake);
    const day = await c.dayMatches('2026-10-12');
    expect(calls[0]).toContain('dateFrom=2026-10-12&dateTo=2026-10-13');
    expect(day).toHaveLength(1);
    const st = await c.standings(39);
    expect(st?.groups).toHaveLength(1);
    expect(st?.groups[0].rows[0]).toMatchObject({ rank: 1, points: 15, form: 'WWW', team: { id: FD_TEAM_OFFSET + 65 } });
    expect(await c.standings(307)).toBeNull();
  });
});

describe('cross-provider team keys', () => {
  // [اسم football-data.org, الاسم المختصر, اسم API-Football]
  const pairs: [string, string, string][] = [
    ['Arsenal FC', 'Arsenal', 'Arsenal'],
    ['Club Atlético de Madrid', 'Atleti', 'Atletico Madrid'],
    ['FC Bayern München', 'Bayern', 'Bayern München'],
    ['Paris Saint-Germain FC', 'PSG', 'Paris Saint Germain'],
    ['TSG 1899 Hoffenheim', 'Hoffenheim', '1899 Hoffenheim'],
    ['1. FSV Mainz 05', 'Mainz', 'FSV Mainz 05'],
    ['Brighton & Hove Albion FC', 'Brighton Hove', 'Brighton'],
    ['FC Internazionale Milano', 'Inter', 'Inter'],
    ['Leeds United FC', 'Leeds United', 'Leeds'],
    ['Deportivo Alavés', 'Alavés', 'Alaves'],
    ['SV 07 Elversberg', 'Elversberg', 'SV Elversberg'],
    ['Angers SCO', 'Angers SCO', 'Angers'],
    ['Real Madrid CF', 'Real Madrid', 'Real Madrid'],
  ];
  it.each(pairs)('%s ≡ %s', (fd, short, af) => {
    expect(teamKey(fd, short)).toBe(teamKey(af));
  });
});

describe('notifications by team key', () => {
  it('matches favourites added from football-data.org by name', () => {
    const base = normFdMatch({ ...fdMatch, status: 'TIMED' })!;
    // مباراة حية من API-Football لنفس الفريق بمعرّف مختلف
    const prev = { ...base, id: 1, league: { id: 135, name: 'Serie A' }, home: { id: 499, name: 'Atalanta' }, away: { id: 517, name: 'Venezia' } };
    const next = { ...prev, status: 'live' as const, minute: 1, score: { home: 0, away: 0 } };
    const [n] = diffMatch(prev, next);
    const events = { kickoff: true, goal: true, redCard: true, halftime: true, fulltime: true };
    expect(wants({ teams: [FD_TEAM_OFFSET + 102], teamKeys: [teamKey('Atalanta BC', 'Atalanta')], leagues: [], events }, n)).toBe(true);
    expect(wants({ teams: [FD_TEAM_OFFSET + 102], leagues: [], events }, n)).toBe(false);
  });
});

describe('ambiguous names', () => {
  it('does not match teams sharing an Arabic name across leagues', async () => {
    const { isAmbiguousKey } = await import('../../shared/teams');
    expect(isAmbiguousKey(teamKey('Al Ahly'))).toBe(true); // الأهلي المصري والسعودي
    expect(isAmbiguousKey(teamKey('Barcelona'))).toBe(false);
    const events = { kickoff: true, goal: true, redCard: true, halftime: true, fulltime: true };
    const m = { id: 1, league: { id: 233, name: '' }, kickoff: '2026-10-10T17:00:00Z', status: 'scheduled' as const, home: { id: 1, name: 'Al Ahly' }, away: { id: 2, name: 'Zamalek' }, score: { home: null, away: null } };
    const [n] = diffMatch(m, { ...m, status: 'live', minute: 1, score: { home: 0, away: 0 } });
    expect(wants({ teams: [], teamKeys: [teamKey('Al-Ahli Saudi')], leagues: [], events }, n)).toBe(false);
    expect(wants({ teams: [], teamKeys: [teamKey('Zamalek SC')], leagues: [], events }, n)).toBe(true);
  });
});
