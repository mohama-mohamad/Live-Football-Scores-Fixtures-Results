import { Link } from 'react-router-dom';
import type { Match } from '../../../shared/types';
import { teamName } from '../../../shared/teams';
import { isFinished, isLive, statusLabel } from '../lib/format';
import { useStore } from '../lib/store';
import { Logo } from './TeamLogo';

export function MatchCard({ m }: { m: Match }) {
  const favIds = useStore((s) => s.favTeams);
  const logoOnly = useStore((s) => s.settings.teamDisplay === 'logo');
  const live = isLive(m.status);
  const done = isFinished(m.status);
  const started = live || done;
  const fav = (id: number) => favIds.some((t) => t.id === id);
  const winner = done && m.score.home != null && m.score.away != null ? (m.score.home > m.score.away ? 'home' : m.score.away > m.score.home ? 'away' : null) : null;
  const pens = m.penalties?.home != null ? `(${m.penalties.home} - ${m.penalties.away})` : null;
  const redCount = (teamId: number) => (m.events ?? []).filter((e) => e.type === 'red' && e.teamId === teamId).length;

  const side = (key: 'home' | 'away') => {
    const t = m[key];
    const reds = redCount(t.id);
    const name = teamName(t.name);
    // بدون شعار نُبقي الاسم ظاهراً حتى لا تلتبس الفرق
    const hideName = logoOnly && !!t.logo;
    return (
      <div
        className={`team team-${key} ${winner === key ? 'win' : ''} ${winner && winner !== key ? 'lose' : ''} ${hideName ? 'logo-only' : ''}`}
        title={name}
        aria-label={hideName ? name : undefined}
      >
        <Logo src={t.logo} name={name} size={hideName ? 40 : 28} />
        {hideName ? (
          (fav(t.id) || reds > 0) && (
            <span className="team-badges">
              {fav(t.id) && <span className="fav-dot">★</span>}
              {reds > 0 && <span className="red-card">{reds > 1 ? reds : ''}</span>}
            </span>
          )
        ) : (
        <span className="team-name">
          {fav(t.id) && <span className="fav-dot" aria-label="مفضل">★</span>}
          {teamName(t.name)}
          {reds > 0 && <span className="red-card" aria-label={`${reds} بطاقة حمراء`}>{reds > 1 ? reds : ''}</span>}
        </span>
        )}
      </div>
    );
  };

  return (
    <Link to={`/match/${m.id}`} className={`match-card ${live ? 'is-live' : ''}`}>
      {side('home')}
      <div className="center">
        {started ? (
          <div className="score" dir="ltr">
            <span>{m.score.away ?? 0}</span>
            <span className="sep">-</span>
            <span>{m.score.home ?? 0}</span>
          </div>
        ) : (
          <div className="kickoff">{statusLabel(m)}</div>
        )}
        {started && (
          <div className={`status ${live ? 'live' : ''}`}>
            {live && <span className="pulse" />}
            <bdi dir="ltr">{statusLabel(m)}</bdi>
          </div>
        )}
        {!started && m.status !== 'scheduled' && <div className="status muted">{statusLabel(m)}</div>}
        {pens && <div className="status muted" dir="ltr">{pens}</div>}
      </div>
      {side('away')}
    </Link>
  );
}
