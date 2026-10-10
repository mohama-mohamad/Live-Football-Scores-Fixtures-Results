import { useQuery } from '@tanstack/react-query';
import type { ApiEnvelope, Match, MatchDetails, Standings } from '../../../shared/types';
import type { LeagueConfig } from '../../../shared/leagues';
import { isLive, timeZone, todayKey } from '../lib/format';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('تعذّر الاتصال بالخادم. تحقّق من الإنترنت.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error ?? `خطأ ${res.status}`, res.status);
  return body as T;
}

export interface Meta {
  provider: string;
  leagues: LeagueConfig[];
  vapidPublicKey: string | null;
  limited: boolean;
  used: number;
  limit: number | null;
  pollSeconds: number;
  favPollSeconds: number;
}

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/api/meta'), staleTime: 60_000 });

export const useLive = () =>
  useQuery({
    queryKey: ['live'],
    queryFn: () => api<ApiEnvelope<Match[]>>('/api/live'),
    refetchInterval: 30_000,
  });

export const useMatches = (date: string) =>
  useQuery({
    queryKey: ['matches', date, timeZone],
    queryFn: () => api<ApiEnvelope<Match[]>>(`/api/matches?date=${date}&tz=${encodeURIComponent(timeZone)}`),
    refetchInterval: (q) => (date === todayKey() || q.state.data?.data.some((m) => isLive(m.status)) ? 45_000 : false),
  });

export const useMatch = (id: number) =>
  useQuery({
    queryKey: ['match', id],
    queryFn: () => api<ApiEnvelope<MatchDetails>>(`/api/match/${id}`),
    refetchInterval: (q) => {
      const m = q.state.data?.data;
      if (!m) return false;
      if (isLive(m.status)) return 30_000;
      return Date.parse(m.kickoff) - Date.now() < 3600_000 && m.status === 'scheduled' ? 60_000 : false;
    },
  });

export const useStandings = (leagueId: number) =>
  useQuery({ queryKey: ['standings', leagueId], queryFn: () => api<ApiEnvelope<Standings>>(`/api/standings/${leagueId}`), staleTime: 5 * 60_000 });

export const useLeagueMatches = (leagueId: number) =>
  useQuery({
    queryKey: ['leagueMatches', leagueId],
    queryFn: () => api<ApiEnvelope<{ last: Match[]; next: Match[] }>>(`/api/league/${leagueId}/matches`),
    staleTime: 5 * 60_000,
  });
