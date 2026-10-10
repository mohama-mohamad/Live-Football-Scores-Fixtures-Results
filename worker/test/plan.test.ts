import { describe, it, expect } from 'vitest';
import type { Match } from '../../shared/types';
import { computePlan, matchWindow, mergedMinutes, MATCH_MS } from '../src/plan';

const H = 3600_000;
const now = Date.parse('2026-10-10T18:00:00Z');
const w = (startH: number, durMin = 125) => ({ start: now + startH * H, end: now + startH * H + durMin * 60_000 });

describe('mergedMinutes', () => {
  it('merges overlapping windows and ignores the past', () => {
    expect(mergedMinutes([w(0, 60), w(0.5, 60)], now)).toBe(90);
    expect(mergedMinutes([w(-1, 90)], now)).toBe(30);
    expect(mergedMinutes([w(0, 60), w(2, 60)], now)).toBe(120);
  });
});

describe('matchWindow', () => {
  const m = (patch: Partial<Match>): Match => ({
    id: 1, league: { id: 1, name: '' }, kickoff: new Date(now).toISOString(), status: 'scheduled',
    home: { id: 1, name: 'a' }, away: { id: 2, name: 'b' }, score: { home: null, away: null }, ...patch,
  });
  it('skips finished matches and extends long-running ones', () => {
    expect(matchWindow(m({ status: 'finished' }), now)).toBeNull();
    expect(matchWindow(m({}), now)!.end).toBe(now + MATCH_MS);
    const late = now + MATCH_MS + 5 * 60_000;
    expect(matchWindow(m({ status: 'live' }), late)!.end).toBe(late + 15 * 60_000);
    expect(matchWindow(m({ status: 'scheduled' }), late)).toBeNull();
  });
});

describe('computePlan (free plan: 60 requests for live)', () => {
  it('one favourite match today: fast ≈ every 3 minutes, others slower', () => {
    const p = computePlan({ favWindows: [w(0)], allWindows: [w(0), w(-1), w(2), w(3)], remaining: 60, now, slowFloorSec: 600 });
    expect(p.mode).toBe('fast');
    expect(p.fastSec).toBeGreaterThanOrEqual(150);
    expect(p.fastSec).toBeLessThanOrEqual(200);
    expect(p.slowSec).toBeGreaterThanOrEqual(600);
    // الطلبات المتوقعة لا تتجاوز الرصيد
    const expected = (125 * 60) / p.fastSec + (mergedMinutes([w(0), w(-1), w(2), w(3)], now) - 125) * 60 / p.slowSec;
    expect(expected * 1.1).toBeLessThanOrEqual(60.5);
  });

  it('no favourites: everything shares the budget at ≥ 10 minutes', () => {
    const p = computePlan({ favWindows: [], allWindows: [w(0), w(3)], remaining: 60, now, slowFloorSec: 600 });
    expect(p.mode).toBe('slow');
    expect(p.slowSec).toBe(600);
  });

  it('paid plan: favourites and others every minute', () => {
    const p = computePlan({ favWindows: [w(0)], allWindows: [w(0), w(1)], remaining: 4500, now, slowFloorSec: 60 });
    expect(p).toMatchObject({ mode: 'fast', fastSec: 60, slowSec: 60 });
  });

  it('idle between matches and stops when the budget is gone', () => {
    expect(computePlan({ favWindows: [], allWindows: [w(2)], remaining: 60, now, slowFloorSec: 600 }).mode).toBe('idle');
    expect(computePlan({ favWindows: [w(0)], allWindows: [w(0)], remaining: 0, now, slowFloorSec: 600 }).mode).toBe('budget');
  });
});
