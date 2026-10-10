// حالة محلية محفوظة في الجهاز: المفضلة والإعدادات
import { useSyncExternalStore } from 'react';
import type { NotificationEvents, Team } from '../../../shared/types';

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  // عرض الفرق في القوائم: الشعار مع الاسم، أو الشعار فقط
  teamDisplay: 'both' | 'logo';
  events: NotificationEvents;
  notificationsEnabled: boolean;
}

export interface State {
  favTeams: Team[];
  favLeagues: number[];
  settings: Settings;
}

const KEY = 'koora:v1';
const DEFAULT: State = {
  favTeams: [],
  favLeagues: [307],
  settings: {
    theme: 'auto',
    teamDisplay: 'both',
    notificationsEnabled: false,
    events: { kickoff: true, goal: true, redCard: true, halftime: false, fulltime: true },
  },
};

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const s = JSON.parse(raw) as Partial<State>;
    return {
      favTeams: s.favTeams ?? DEFAULT.favTeams,
      favLeagues: s.favLeagues ?? DEFAULT.favLeagues,
      settings: { ...DEFAULT.settings, ...s.settings, events: { ...DEFAULT.settings.events, ...s.settings?.events } },
    };
  } catch {
    return DEFAULT;
  }
}

let state = load();
const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(fn: (s: State) => State) {
  state = fn(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // التخزين غير متاح (وضع التصفح الخاص) — نكمل بدون حفظ
  }
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export function toggleTeam(team: Team) {
  setState((s) => ({
    ...s,
    favTeams: s.favTeams.some((t) => t.id === team.id) ? s.favTeams.filter((t) => t.id !== team.id) : [...s.favTeams, { id: team.id, name: team.name, logo: team.logo }],
  }));
}

export function toggleLeague(id: number) {
  setState((s) => ({ ...s, favLeagues: s.favLeagues.includes(id) ? s.favLeagues.filter((x) => x !== id) : [...s.favLeagues, id] }));
}

export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}
