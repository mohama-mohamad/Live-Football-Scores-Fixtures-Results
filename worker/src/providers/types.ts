import type { Match, MatchDetails, Standings } from '../../../shared/types';

// واجهة موحّدة لأي مزوّد بيانات
export interface Provider {
  name: string;
  // هل يُحتسب كل طلب من الحد اليومي؟
  limited: boolean;
  // كل مباريات الدوريات المتابَعة في يوم بتوقيت UTC (YYYY-MM-DD)
  matchesByUtcDate(date: string): Promise<Match[]>;
  // المباريات الجارية الآن في الدوريات المتابَعة
  live(): Promise<Match[]>;
  // مباريات بمعرّفاتها (للتأكد من نهاية مباراة اختفت من قائمة المباشر)
  matchesByIds(ids: number[]): Promise<Match[]>;
  match(id: number): Promise<MatchDetails | null>;
  standings(leagueId: number): Promise<Standings | null>;
  leagueMatches(leagueId: number): Promise<{ last: Match[]; next: Match[] }>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}
