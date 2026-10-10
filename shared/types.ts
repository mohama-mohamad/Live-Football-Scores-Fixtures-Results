// أنواع البيانات الموحّدة بين الخادم (Worker) والتطبيق.
// كل مزوّد بيانات (API-Football، التجريبي...) يحوّل ردوده إلى هذه الأنواع.

export type MatchStatus =
  | 'scheduled' // لم تبدأ
  | 'live' // جارية (شوط أول / ثانٍ / إضافي)
  | 'halftime' // استراحة بين الشوطين
  | 'penalties' // ركلات ترجيح
  | 'finished' // انتهت
  | 'postponed' // مؤجلة
  | 'cancelled' // ملغاة أو موقوفة
  | 'unknown';

export interface Team {
  id: number;
  name: string;
  short?: string; // الاسم المختصر (من football-data.org) للمساعدة في ربط الفرق بين المزوّدين
  logo?: string;
}

export interface League {
  id: number;
  name: string;
  country?: string;
  logo?: string;
  season?: number;
}

export type EventType = 'goal' | 'own_goal' | 'penalty_goal' | 'missed_penalty' | 'yellow' | 'red' | 'sub' | 'var';

export interface MatchEvent {
  minute: number;
  extra?: number;
  type: EventType;
  teamId: number;
  player?: string;
  assist?: string;
  detail?: string;
}

export interface StatPair {
  key: string; // مفتاح موحّد مثل possession, shots_total
  home: number | string | null;
  away: number | string | null;
}

export interface LineupPlayer {
  name: string;
  number?: number;
  pos?: string;
}

export interface Lineup {
  teamId: number;
  formation?: string;
  coach?: string;
  startXI: LineupPlayer[];
  subs: LineupPlayer[];
}

export interface Match {
  id: number;
  league: League;
  round?: string;
  kickoff: string; // ISO 8601
  status: MatchStatus;
  statusShort?: string; // الرمز الأصلي من المزوّد
  minute?: number | null;
  home: Team;
  away: Team;
  score: { home: number | null; away: number | null };
  penalties?: { home: number | null; away: number | null };
  venue?: string;
  referee?: string;
  events?: MatchEvent[];
}

export interface MatchDetails extends Match {
  stats?: StatPair[];
  lineups?: Lineup[];
}

export interface StandingRow {
  rank: number;
  team: Team;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form?: string;
  group?: string;
}

export interface Standings {
  league: League;
  groups: { name: string; rows: StandingRow[] }[];
}

export interface ApiEnvelope<T> {
  data: T;
  updatedAt: string;
  provider: string;
  stale?: boolean;
}

// تفضيلات التنبيهات المرسلة من التطبيق إلى الخادم
export interface NotificationEvents {
  kickoff: boolean;
  goal: boolean;
  redCard: boolean;
  halftime: boolean;
  fulltime: boolean;
}

export interface PushPrefs {
  teams: number[];
  // مفاتيح أسماء فرق لم يُعرف معرّفها في API-Football بعد (أُضيفت من بيانات football-data.org)
  teamKeys?: string[];
  leagues: number[];
  events: NotificationEvents;
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  icon?: string;
}
