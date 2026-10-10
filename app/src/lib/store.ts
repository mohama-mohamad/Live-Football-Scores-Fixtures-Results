// حالة محلية محفوظة في الجهاز: المفضلة والإعدادات
import { useSyncExternalStore } from 'react';
import type { NotificationEvents, Team } from '../../../shared/types';
import { isAmbiguousKey, teamKey } from '../../../shared/teams';

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  // عرض الفرق في القوائم: الشعار مع الاسم، أو الشعار فقط
  teamDisplay: 'both' | 'logo';
  events: NotificationEvents;
  notificationsEnabled: boolean;
}

export interface State {
  // مصدر البيانات الذي حُفظت به المفضلة (معرّفات الفرق تختلف بين المصادر)
  provider?: string;
  // تنبيه لمرة واحدة بعد مسح فرق مصدر قديم
  favReset?: boolean;
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
      provider: s.provider,
      favReset: s.favReset,
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

// هل الفريق في المفضلة؟ بالمعرّف، أو بالاسم (المعرّفات تختلف بين مصدري البيانات)
// ما عدا الأسماء المشتركة بين أكثر من فريق
export function isFavTeam(favs: Team[], team: Team): boolean {
  const key = teamKey(team.name, team.short);
  return favs.some((f) => f.id === team.id || (!isAmbiguousKey(key) && teamKey(f.name, f.short) === key));
}

export function toggleTeam(team: Team) {
  setState((s) => ({
    ...s,
    favTeams: isFavTeam(s.favTeams, team)
      ? s.favTeams.filter((t) => !isFavTeam([t], team))
      : [...s.favTeams, { id: team.id, name: team.name, short: team.short, logo: team.logo }],
  }));
}

export function toggleLeague(id: number) {
  setState((s) => ({ ...s, favLeagues: s.favLeagues.includes(id) ? s.favLeagues.filter((x) => x !== id) : [...s.favLeagues, id] }));
}

// معرّفات فرق البيانات التجريبية: رقم الدوري × 1000 + ترتيب الفريق
const MOCK_LEAGUES = [307, 39, 140, 2, 233, 135, 78, 61];
const looksMock = (id: number) => MOCK_LEAGUES.includes(Math.floor(id / 1000)) && id % 1000 < 12;

// عند تغيّر مصدر البيانات نمسح الفرق المفضلة القديمة (البطولات تبقى لأن معرّفاتها واحدة)
export function syncProvider(provider: string) {
  const s = state;
  if (s.provider === provider) return;
  const changed = s.provider !== undefined || (provider !== 'mock' && s.favTeams.some((t) => looksMock(t.id)));
  setState((cur) => ({
    ...cur,
    provider,
    favTeams: changed ? [] : cur.favTeams,
    favReset: changed && cur.favTeams.length > 0 ? true : cur.favReset,
  }));
}

export function dismissFavReset() {
  setState((s) => ({ ...s, favReset: false }));
}

export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}
