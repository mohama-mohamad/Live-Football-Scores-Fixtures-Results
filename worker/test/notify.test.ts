import { describe, it, expect } from 'vitest';
import type { Match } from '../../shared/types';
import { diffMatch, forTeam } from '../src/notify';
import { wants } from '../src/service';

const base: Match = {
  id: 1,
  league: { id: 307, name: 'Saudi Pro League' },
  kickoff: '2026-10-10T17:00:00Z',
  status: 'scheduled',
  minute: null,
  home: { id: 10, name: 'Al-Hilal' },
  away: { id: 20, name: 'Al-Nassr' },
  score: { home: null, away: null },
  events: [],
};
const at = (patch: Partial<Match>): Match => ({ ...base, ...patch });

describe('diffMatch', () => {
  it('detects kickoff', () => {
    const n = diffMatch(base, at({ status: 'live', minute: 1, score: { home: 0, away: 0 } }));
    expect(n.map((x) => x.kind)).toEqual(['kickoff']);
    expect(n[0].payload.body).toContain('الهلال × النصر');
    expect(n[0].payload.body).toContain('دوري روشن السعودي');
  });

  it('detects a goal with scorer in Arabic', () => {
    const prev = at({ status: 'live', minute: 20, score: { home: 0, away: 0 } });
    const next = at({ status: 'live', minute: 23, score: { home: 1, away: 0 }, events: [{ minute: 23, type: 'goal', teamId: 10, player: 'سالم الدوسري' }] });
    const n = diffMatch(prev, next);
    expect(n).toHaveLength(1);
    expect(n[0].kind).toBe('goal');
    expect(n[0].payload.title).toBe('⚽ هدف للهلال!');
    expect(n[0].payload.body).toBe("الهلال 1 - 0 النصر (23') — سالم الدوسري");
    expect(n[0].payload.url).toBe('/match/1');
  });

  it('detects disallowed goal, red card, halftime and full time', () => {
    const live = at({ status: 'live', minute: 40, score: { home: 1, away: 0 }, events: [] });
    expect(diffMatch(live, at({ status: 'live', minute: 41, score: { home: 0, away: 0 }, events: [] }))[0].payload.title).toBe('❌ إلغاء هدف');
    const red = diffMatch(live, at({ status: 'live', minute: 42, score: { home: 1, away: 0 }, events: [{ minute: 42, type: 'red', teamId: 20, player: 'X' }] }));
    expect(red.map((x) => x.kind)).toEqual(['redCard']);
    expect(red[0].payload.title).toContain('النصر');
    expect(diffMatch(live, at({ status: 'halftime', minute: 45, score: { home: 1, away: 0 } })).map((x) => x.kind)).toEqual(['halftime']);
    expect(diffMatch(live, at({ status: 'finished', minute: 90, score: { home: 1, away: 0 } })).map((x) => x.kind)).toEqual(['fulltime']);
  });

  it('does not spam when a match is first seen mid-game', () => {
    expect(diffMatch(undefined, at({ status: 'live', minute: 60, score: { home: 2, away: 1 } }))).toEqual([]);
  });

  it('reports nothing when nothing changed', () => {
    const live = at({ status: 'live', minute: 30, score: { home: 1, away: 1 } });
    expect(diffMatch(live, { ...live, minute: 31 })).toEqual([]);
  });

  it('builds Arabic preposition correctly', () => {
    expect(forTeam('الهلال')).toBe('للهلال');
    expect(forTeam('برشلونة')).toBe('لـبرشلونة');
  });
});

describe('wants', () => {
  const notice = diffMatch(base, at({ status: 'live', minute: 1, score: { home: 0, away: 0 } }))[0];
  const events = { kickoff: true, goal: true, redCard: true, halftime: true, fulltime: true };
  it('matches by team or league and respects event toggles', () => {
    expect(wants({ teams: [20], leagues: [], events }, notice)).toBe(true);
    expect(wants({ teams: [], leagues: [307], events }, notice)).toBe(true);
    expect(wants({ teams: [99], leagues: [39], events }, notice)).toBe(false);
    expect(wants({ teams: [10], leagues: [], events: { ...events, kickoff: false } }, notice)).toBe(false);
  });
});
