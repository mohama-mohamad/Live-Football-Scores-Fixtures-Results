// اكتشاف التغيّرات بين حالتين لنفس المباراة وصياغة نص التنبيه بالعربية
import type { Match, NotificationEvents, PushPayload } from '../../shared/types';
import { teamName } from '../../shared/teams';
import { leagueName } from '../../shared/leagues';

export type NoticeKind = keyof NotificationEvents;

export interface Notice {
  kind: NoticeKind;
  match: Match;
  payload: PushPayload;
}

const isGoal = (t: string) => t === 'goal' || t === 'penalty_goal' || t === 'own_goal';
const inPlay = (m: Match) => m.status === 'live' || m.status === 'halftime' || m.status === 'penalties';

function scoreLine(m: Match): string {
  return `${teamName(m.home.name)} ${m.score.home ?? 0} - ${m.score.away ?? 0} ${teamName(m.away.name)}`;
}

function minuteLabel(minute?: number | null, extra?: number | null): string {
  if (minute == null) return '';
  return extra ? ` (${minute}+${extra}')` : ` (${minute}')`;
}

// "للهلال" بدلاً من "لـالهلال"
export function forTeam(name: string): string {
  return name.startsWith('ال') ? `لل${name.slice(2)}` : `لـ${name}`;
}

function payload(m: Match, title: string, body: string, kind: string): PushPayload {
  return { title, body, tag: `m${m.id}-${kind}`, url: `/match/${m.id}` };
}

export function diffMatch(prev: Match | undefined, next: Match): Notice[] {
  const out: Notice[] = [];
  const league = leagueName(next.league.id, next.league.name);
  const home = teamName(next.home.name);
  const away = teamName(next.away.name);

  // بداية المباراة (أو أول مرة نراها وهي في دقائقها الأولى)
  const wasNotStarted = !prev || prev.status === 'scheduled' || prev.status === 'unknown';
  if (wasNotStarted && next.status === 'live' && (prev || (next.minute ?? 0) <= 5)) {
    out.push({ kind: 'kickoff', match: next, payload: payload(next, '🟢 انطلقت المباراة', `${home} × ${away} — ${league}`, 'ko') });
  }

  // لا ننبّه عن الأهداف والبطاقات لمباراة نراها لأول مرة (لتجنب سيل من التنبيهات القديمة)
  if (prev) {
    for (const side of ['home', 'away'] as const) {
      const before = prev.score[side] ?? 0;
      const after = next.score[side] ?? 0;
      const team = side === 'home' ? next.home : next.away;
      if (after > before) {
        // آخر هدف محسوب لهذا الفريق
        const goal = [...(next.events ?? [])].reverse().find((e) => isGoal(e.type) && e.teamId === team.id);
        const scorer = goal?.player ? ` — ${goal.player}${goal.type === 'penalty_goal' ? ' (ركلة جزاء)' : goal.type === 'own_goal' ? ' (بالخطأ في مرماه)' : ''}` : '';
        const minute = minuteLabel(goal?.minute ?? next.minute, goal?.extra);
        out.push({
          kind: 'goal',
          match: next,
          payload: payload(next, `⚽ هدف ${forTeam(teamName(team.name))}!`, `${scoreLine(next)}${minute}${scorer}`, `g${next.score.home}-${next.score.away}`),
        });
      } else if (after < before && next.status !== 'finished') {
        out.push({ kind: 'goal', match: next, payload: payload(next, '❌ إلغاء هدف', `${scoreLine(next)} — بعد مراجعة الفيديو`, `g${next.score.home}-${next.score.away}`) });
      }
    }

    const reds = (m: Match, teamId: number) => (m.events ?? []).filter((e) => e.type === 'red' && e.teamId === teamId).length;
    if (prev.events && next.events) {
      for (const team of [next.home, next.away]) {
        if (reds(next, team.id) > reds(prev, team.id)) {
          const card = [...next.events].reverse().find((e) => e.type === 'red' && e.teamId === team.id);
          out.push({
            kind: 'redCard',
            match: next,
            payload: payload(
              next,
              `🟥 بطاقة حمراء — ${teamName(team.name)}`,
              `${card?.player ?? ''}${minuteLabel(card?.minute, card?.extra)} • ${scoreLine(next)}`.trim(),
              `r${team.id}-${reds(next, team.id)}`,
            ),
          });
        }
      }
    }

    if (prev.status === 'live' && next.status === 'halftime' && (next.minute ?? 45) <= 50) {
      out.push({ kind: 'halftime', match: next, payload: payload(next, '⏸️ نهاية الشوط الأول', scoreLine(next), 'ht') });
    }

    if (inPlay(prev) && next.status === 'finished') {
      const pens = next.penalties && next.penalties.home != null ? ` (ركلات الترجيح ${next.penalties.home} - ${next.penalties.away})` : '';
      out.push({ kind: 'fulltime', match: next, payload: payload(next, '🏁 نهاية المباراة', `${scoreLine(next)}${pens}`, 'ft') });
    }
  }
  return out;
}
