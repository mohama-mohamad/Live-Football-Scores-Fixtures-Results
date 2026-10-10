import { describe, it, expect } from 'vitest';
import { MockProvider } from '../src/providers/mock';
import { diffMatch } from '../src/notify';
import { localDayRange, utcDatesCovering } from '../src/time';

describe('MockProvider', () => {
  it('is deterministic and progresses through a full match', async () => {
    const t0 = Date.parse('2026-10-10T00:00:00Z');
    const day = await new MockProvider(() => t0).matchesByUtcDate('2026-10-10');
    expect(day.length).toBeGreaterThan(40);
    const again = await new MockProvider(() => t0).matchesByUtcDate('2026-10-10');
    expect(again).toEqual(day);

    const target = day.find((m) => m.status === 'scheduled')!;
    const ko = Date.parse(target.kickoff);
    const kinds: string[] = [];
    let prev = undefined as typeof target | undefined;
    for (let t = ko - 60_000; t < ko + 120 * 60_000; t += 60_000) {
      const [m] = await new MockProvider(() => t).matchesByIds([target.id]);
      kinds.push(...diffMatch(prev, m).map((n) => n.kind));
      prev = m;
    }
    expect(prev!.status).toBe('finished');
    expect(kinds[0]).toBe('kickoff');
    expect(kinds).toContain('halftime');
    expect(kinds.at(-1)).toBe('fulltime');
    expect(kinds.filter((k) => k === 'goal').length).toBe((prev!.score.home ?? 0) + (prev!.score.away ?? 0));
  });

  it('returns details with stats and lineups', async () => {
    const p = new MockProvider(() => Date.parse('2026-10-10T23:59:00Z'));
    const [m] = (await p.matchesByUtcDate('2026-10-10')).filter((x) => x.status === 'finished');
    const d = await p.match(m.id);
    expect(d?.lineups).toHaveLength(2);
    expect(d?.lineups?.[0].startXI).toHaveLength(11);
    expect(d?.stats?.find((s) => s.key === 'possession')).toBeTruthy();
  });

  it('has standings', async () => {
    const s = await new MockProvider().standings(39);
    expect(s?.groups[0].rows).toHaveLength(12);
    expect(s?.groups[0].rows[0].rank).toBe(1);
  });
});

describe('time', () => {
  it('computes local day ranges', () => {
    const [s, e] = localDayRange('2026-10-10', 'Asia/Riyadh');
    expect(new Date(s).toISOString()).toBe('2026-10-09T21:00:00.000Z');
    expect(new Date(e).toISOString()).toBe('2026-10-10T21:00:00.000Z');
    expect(utcDatesCovering(s, e)).toEqual(['2026-10-09', '2026-10-10']);
    const [s2] = localDayRange('2026-10-10', 'America/New_York');
    expect(new Date(s2).toISOString()).toBe('2026-10-10T04:00:00.000Z');
    expect(utcDatesCovering(...localDayRange('2026-10-10', 'UTC'))).toEqual(['2026-10-10']);
  });
});
