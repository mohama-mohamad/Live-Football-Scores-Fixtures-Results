import { describe, it, expect } from 'vitest';
import { ApiFootballProvider, normFixture } from '../src/providers/apiFootball';

const fixture = {
  fixture: { id: 1, referee: 'Ref', timestamp: 1791651600, venue: { name: 'Kingdom Arena', city: 'Riyadh' }, status: { short: '2H', elapsed: 67 } },
  league: { id: 307, name: 'Pro League', country: 'Saudi-Arabia', logo: 'l.png', season: 2026, round: 'Regular Season - 7' },
  teams: { home: { id: 2932, name: 'Al-Hilal Saudi FC', logo: 'h.png' }, away: { id: 2939, name: 'Al-Nassr', logo: 'a.png' } },
  goals: { home: 2, away: 1 },
  score: { penalty: { home: null, away: null } },
  events: [
    { time: { elapsed: 10, extra: null }, team: { id: 2932 }, player: { name: 'S. Al Dawsari' }, assist: { name: null }, type: 'Goal', detail: 'Normal Goal' },
    { time: { elapsed: 30, extra: null }, team: { id: 2939 }, player: { name: 'C. Ronaldo' }, assist: {}, type: 'Goal', detail: 'Penalty' },
    { time: { elapsed: 55, extra: null }, team: { id: 2939 }, player: { name: 'X' }, assist: {}, type: 'Card', detail: 'Red Card' },
    { time: { elapsed: 60, extra: null }, team: { id: 2932 }, player: { name: 'Y' }, assist: {}, type: 'Goal', detail: 'Own Goal' },
  ],
  statistics: [
    { team: { id: 2932 }, statistics: [{ type: 'Ball Possession', value: '58%' }, { type: 'Total Shots', value: 12 }] },
    { team: { id: 2939 }, statistics: [{ type: 'Ball Possession', value: '42%' }, { type: 'Total Shots', value: 7 }] },
  ],
};

describe('API-Football normalization', () => {
  it('maps fixtures to the shared model', () => {
    const m = normFixture(fixture);
    expect(m.status).toBe('live');
    expect(m.minute).toBe(67);
    expect(m.score).toEqual({ home: 2, away: 1 });
    expect(m.events?.map((e) => e.type)).toEqual(['goal', 'penalty_goal', 'red', 'own_goal']);
    expect(m.stats).toEqual([
      { key: 'possession', home: '58%', away: '42%' },
      { key: 'shots_total', home: 12, away: 7 },
    ]);
    expect(m.venue).toBe('Kingdom Arena، Riyadh');
  });

  it('surfaces plan errors and counts requests', async () => {
    let count = 0;
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ errors: { plan: 'Free plans do not have access to this season' }, response: [] }))) as unknown as typeof fetch;
    const p = new ApiFootballProvider('k', { onRequest: async () => void count++ }, fakeFetch);
    await expect(p.live()).rejects.toThrow(/Free plans/);
    expect(count).toBe(1);
  });

  it('filters date results to tracked leagues', async () => {
    const other = { ...fixture, league: { ...fixture.league, id: 999999 } };
    const fakeFetch = (async (url: string) => {
      expect(url).toContain('date=2026-10-10');
      return new Response(JSON.stringify({ errors: [], response: [fixture, other] }));
    }) as unknown as typeof fetch;
    const list = await new ApiFootballProvider('k', {}, fakeFetch).matchesByUtcDate('2026-10-10');
    expect(list.map((m) => m.league.id)).toEqual([307]);
    expect('stats' in list[0]).toBe(false);
  });
});

describe('extractTracked (large responses)', () => {
  const big = (n: number, extraTail = '') => {
    const items = Array.from({ length: n }, (_, i) => ({
      ...fixture,
      fixture: { ...fixture.fixture, id: 9000 + i },
      league: { ...fixture.league, id: i % 10 === 0 ? 307 : 5000 + i },
      events: [{ time: { elapsed: 1 }, team: { id: 1 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'x ] y' } }],
    }));
    return JSON.stringify({ get: 'fixtures', parameters: { date: '2026-10-10' }, errors: [], results: n, paging: { current: 1, total: 1 }, response: items }) + extraTail;
  };

  it('matches a full parse and keeps only tracked leagues', async () => {
    const { extractTracked } = await import('../src/providers/apiFootball');
    const text = big(800);
    expect(text.length).toBeGreaterThan(200_000);
    const fast = extractTracked(text);
    const full = JSON.parse(text).response.filter((f: { league: { id: number } }) => f.league.id === 307);
    expect(fast).toEqual(full);
    expect(fast).toHaveLength(80);
  });

  it('falls back to a full parse for unexpected layouts', async () => {
    const { extractTracked } = await import('../src/providers/apiFootball');
    // الحقل response ليس الأخير
    const obj = JSON.parse(big(800));
    const reordered = JSON.stringify({ response: obj.response, errors: [], tail: ['a]b'] });
    expect(extractTracked(reordered)).toHaveLength(80);
  });
});

describe('default fetcher binding', () => {
  it('does not call fetch with the provider as `this` (Workers throws "Illegal invocation")', async () => {
    const original = globalThis.fetch;
    let receiver: unknown = 'unset';
    globalThis.fetch = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response(JSON.stringify({ errors: [], response: [] })));
    } as typeof fetch;
    try {
      await new ApiFootballProvider('k').live();
      expect(receiver === undefined || receiver === globalThis).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
