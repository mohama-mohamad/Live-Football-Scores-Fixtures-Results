import { Link, useParams, useSearchParams } from 'react-router-dom';
import { leagueName } from '../../../shared/leagues';
import { teamName } from '../../../shared/teams';
import type { Lineup, MatchDetails, MatchEvent, Team } from '../../../shared/types';
import { useMatch } from '../api/client';
import { StarIcon } from '../components/Icons';
import { Logo } from '../components/TeamLogo';
import { Empty, ErrorBox, Loading, StaleBanner } from '../components/States';
import { formatFullDate, formatTime, isLive, STAT_LABELS, statusLabel } from '../lib/format';
import { isFavTeam, toggleTeam, useStore } from '../lib/store';

const TABS = [
  { key: 'events', label: 'الأحداث' },
  { key: 'stats', label: 'الإحصائيات' },
  { key: 'lineups', label: 'التشكيلة' },
  { key: 'info', label: 'التفاصيل' },
] as const;

const EVENT_ICON: Record<MatchEvent['type'], string> = {
  goal: '⚽',
  penalty_goal: '⚽',
  own_goal: '⚽',
  missed_penalty: '❌',
  yellow: '🟨',
  red: '🟥',
  sub: '🔄',
  var: '📺',
};

function eventText(e: MatchEvent): { main: string; sub?: string } {
  switch (e.type) {
    case 'penalty_goal':
      return { main: e.player ?? 'هدف', sub: 'ركلة جزاء' };
    case 'own_goal':
      return { main: e.player ?? 'هدف', sub: 'هدف عكسي' };
    case 'missed_penalty':
      return { main: e.player ?? '', sub: 'ركلة جزاء ضائعة' };
    case 'goal':
      return { main: e.player ?? 'هدف', sub: e.assist ? `صناعة: ${e.assist}` : undefined };
    case 'sub':
      // assist = اللاعب الداخل، player = الخارج
      return { main: `⬆ ${e.assist ?? ''}`, sub: `⬇ ${e.player ?? ''}` };
    case 'var':
      return { main: 'مراجعة الفيديو', sub: e.detail };
    default:
      return { main: e.player ?? '' };
  }
}

function FavStar({ team }: { team: Team }) {
  const fav = useStore((s) => isFavTeam(s.favTeams, team));
  return (
    <button className={`icon-btn star small ${fav ? 'on' : ''}`} onClick={() => toggleTeam(team)} aria-label={fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'} aria-pressed={fav}>
      <StarIcon filled={fav} width={18} height={18} />
    </button>
  );
}

function Hero({ m }: { m: MatchDetails }) {
  const live = isLive(m.status);
  const started = live || m.status === 'finished';
  const scorers = (teamId: number) =>
    (m.events ?? [])
      .filter((e) => (e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'own_goal') && e.teamId === teamId)
      .map((e) => ({ name: `${e.player ?? ''}${e.type === 'penalty_goal' ? ' (ج)' : e.type === 'own_goal' ? ' (ع)' : ''}`, minute: `${e.minute}'` }));
  const side = (t: Team) => (
    <div className="hero-team">
      <Logo src={t.logo} name={teamName(t.name)} size={56} />
      <div className="hero-name">{teamName(t.name)}</div>
      <FavStar team={t} />
      <ul className="scorers">
        {scorers(t.id).map((s, i) => (
          <li key={i}>
            {s.name} <bdi dir="ltr">{s.minute}</bdi>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className={`hero ${live ? 'is-live' : ''}`}>
      <Link to={`/league/${m.league.id}`} className="hero-league">
        {leagueName(m.league.id, m.league.name)}
        {m.round ? ` • ${m.round}` : ''}
      </Link>
      <div className="hero-row">
        {side(m.home)}
        <div className="hero-center">
          {started ? (
            <div className="hero-score" dir="ltr">
              {m.score.away ?? 0} - {m.score.home ?? 0}
            </div>
          ) : (
            <div className="hero-time">{formatTime(m.kickoff)}</div>
          )}
          <div className={`status ${live ? 'live' : ''}`}>
            {live && <span className="pulse" />}
            {started || m.status !== 'scheduled' ? <bdi dir="ltr">{statusLabel(m)}</bdi> : formatFullDate(m.kickoff)}
          </div>
          {m.penalties?.home != null && (
            <div className="status muted" dir="ltr">
              ({m.penalties.away} - {m.penalties.home})
            </div>
          )}
        </div>
        {side(m.away)}
      </div>
    </div>
  );
}

function Events({ m }: { m: MatchDetails }) {
  const list = [...(m.events ?? [])].sort((a, b) => b.minute - a.minute || (b.extra ?? 0) - (a.extra ?? 0));
  if (!list.length) return <Empty icon="⏱️" title={m.status === 'scheduled' ? 'لم تبدأ المباراة بعد' : 'لا توجد أحداث'} />;
  const htIndex = list.findIndex((e) => e.minute <= 45);
  return (
    <div className="timeline">
      {list.map((e, i) => {
        const t = eventText(e);
        const home = e.teamId === m.home.id;
        return (
          <div key={i}>
            {i === htIndex && htIndex > 0 && <div className="tl-sep">نهاية الشوط الأول</div>}
            <div className={`tl-row ${home ? 'home' : 'away'} ev-${e.type}`}>
              <div className="tl-side">
                {home && (
                  <div className="tl-event">
                    <span className="tl-icon">{EVENT_ICON[e.type]}</span>
                    <div>
                      <div className="tl-main">{t.main}</div>
                      {t.sub && <div className="tl-sub">{t.sub}</div>}
                    </div>
                  </div>
                )}
              </div>
              <div className="tl-min" dir="ltr">
                {e.minute}
                {e.extra ? `+${e.extra}` : ''}'
              </div>
              <div className="tl-side">
                {!home && (
                  <div className="tl-event">
                    <span className="tl-icon">{EVENT_ICON[e.type]}</span>
                    <div>
                      <div className="tl-main">{t.main}</div>
                      {t.sub && <div className="tl-sub">{t.sub}</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const num = (v: number | string | null) => (v == null ? 0 : typeof v === 'number' ? v : parseFloat(v) || 0);

function Stats({ m }: { m: MatchDetails }) {
  if (!m.stats?.length) return <Empty icon="📊" title="الإحصائيات غير متوفرة بعد" />;
  return (
    <div className="stats">
      <div className="stats-head">
        <span>{teamName(m.home.name)}</span>
        <span>{teamName(m.away.name)}</span>
      </div>
      {m.stats.map((s) => {
        const h = num(s.home);
        const a = num(s.away);
        const total = h + a || 1;
        return (
          <div className="stat" key={s.key}>
            <div className="stat-top">
              <span className={h > a ? 'lead' : ''}>{s.home ?? 0}</span>
              <span className="stat-label">{STAT_LABELS[s.key] ?? s.key}</span>
              <span className={a > h ? 'lead' : ''}>{s.away ?? 0}</span>
            </div>
            <div className="stat-bars">
              <div className="bar home">
                <i style={{ width: `${(h / total) * 100}%` }} />
              </div>
              <div className="bar away">
                <i style={{ width: `${(a / total) * 100}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const POS: Record<string, string> = { G: 'حارس', D: 'دفاع', M: 'وسط', F: 'هجوم' };

function TeamLineup({ l, team }: { l: Lineup; team: Team }) {
  return (
    <section className="lineup">
      <header className="lineup-head">
        <Logo src={team.logo} name={teamName(team.name)} size={24} />
        <strong>{teamName(team.name)}</strong>
        {l.formation && <span className="formation" dir="ltr">{l.formation}</span>}
      </header>
      {l.coach && <div className="coach">المدرب: {l.coach}</div>}
      <ol className="players">
        {l.startXI.map((p, i) => (
          <li key={i}>
            <span className="shirt">{p.number ?? ''}</span>
            <span className="pname">{p.name}</span>
            {p.pos && <span className="pos">{POS[p.pos] ?? p.pos}</span>}
          </li>
        ))}
      </ol>
      {l.subs.length > 0 && (
        <>
          <div className="subs-title">البدلاء</div>
          <ol className="players subs">
            {l.subs.map((p, i) => (
              <li key={i}>
                <span className="shirt">{p.number ?? ''}</span>
                <span className="pname">{p.name}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function Lineups({ m }: { m: MatchDetails }) {
  if (!m.lineups?.length) return <Empty icon="👕" title="التشكيلة لم تُعلن بعد" >تُعلن عادةً قبل المباراة بساعة تقريباً</Empty>;
  const team = (id: number) => (id === m.home.id ? m.home : m.away);
  return (
    <>
      {m.lineups.map((l) => (
        <TeamLineup key={l.teamId} l={l} team={team(l.teamId)} />
      ))}
    </>
  );
}

function Info({ m }: { m: MatchDetails }) {
  const rows: [string, string | undefined][] = [
    ['البطولة', leagueName(m.league.id, m.league.name)],
    ['الجولة', m.round],
    ['التاريخ', formatFullDate(m.kickoff)],
    ['التوقيت', formatTime(m.kickoff)],
    ['الملعب', m.venue],
    ['الحكم', m.referee],
  ];
  return (
    <div className="list-card">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div className="info-row" key={k}>
            <span className="muted">{k}</span>
            <span>{v}</span>
          </div>
        ))}
    </div>
  );
}

export function MatchPage() {
  const id = Number(useParams().id);
  const q = useMatch(id);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as (typeof TABS)[number]['key']) ?? 'events';

  if (q.isPending) return <Loading rows={5} />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data.data;

  return (
    <>
      <StaleBanner show={q.data.stale} />
      <Hero m={m} />
      <div className="segmented" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setParams({ tab: t.key }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'events' && <Events m={m} />}
      {tab === 'stats' && <Stats m={m} />}
      {tab === 'lineups' && <Lineups m={m} />}
      {tab === 'info' && <Info m={m} />}
    </>
  );
}
