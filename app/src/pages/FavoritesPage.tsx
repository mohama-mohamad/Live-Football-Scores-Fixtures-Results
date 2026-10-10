import { Link } from 'react-router-dom';
import { LEAGUES } from '../../../shared/leagues';
import { teamName } from '../../../shared/teams';
import { useMatches } from '../api/client';
import { LeagueSection, groupByLeague } from '../components/LeagueSection';
import { BellIcon } from '../components/Icons';
import { Logo } from '../components/TeamLogo';
import { Empty, Loading } from '../components/States';
import { todayKey } from '../lib/format';
import { toggleLeague, toggleTeam, useStore } from '../lib/store';

export function FavoritesPage() {
  const favTeams = useStore((s) => s.favTeams);
  const favLeagues = useStore((s) => s.favLeagues);
  const notifOn = useStore((s) => s.settings.notificationsEnabled);
  const today = useMatches(todayKey());

  const teamIds = new Set(favTeams.map((t) => t.id));
  const todays = (today.data?.data ?? []).filter((m) => teamIds.has(m.home.id) || teamIds.has(m.away.id));

  return (
    <>
      {!notifOn && (
        <Link to="/settings" className="cta">
          <BellIcon />
          <div>
            <strong>فعّل التنبيهات</strong>
            <div className="list-sub">أهداف وبداية ونهاية مباريات فرقك المفضلة مباشرةً على جوالك</div>
          </div>
        </Link>
      )}

      <h2 className="section-title">فرقي</h2>
      {favTeams.length === 0 ? (
        <Empty icon="⭐" title="لم تضف أي فريق بعد">
          افتح أي مباراة واضغط ★ بجانب الفريق، أو اضغط على اسم الفريق في <Link to="/leagues">جدول الترتيب</Link>.
        </Empty>
      ) : (
        <div className="chip-grid">
          {favTeams.map((t) => (
            <div className="team-chip" key={t.id}>
              <Logo src={t.logo} name={teamName(t.name)} size={26} />
              <span>{teamName(t.name)}</span>
              <button className="chip-x" onClick={() => toggleTeam(t)} aria-label={`إزالة ${teamName(t.name)}`}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {favTeams.length > 0 && (
        <>
          <h2 className="section-title">مباريات فرقي اليوم</h2>
          {today.isPending ? (
            <Loading rows={2} />
          ) : todays.length === 0 ? (
            <p className="hint">لا توجد مباريات لفرقك المفضلة اليوم.</p>
          ) : (
            groupByLeague(todays).map((g) => <LeagueSection key={g.leagueId} matches={g.matches} />)
          )}
        </>
      )}

      <h2 className="section-title">بطولاتي</h2>
      <p className="hint">ستصلك تنبيهات كل مباريات البطولات المختارة.</p>
      <div className="chip-grid">
        {LEAGUES.map((l) => {
          const on = favLeagues.includes(l.id);
          return (
            <button key={l.id} className={`chip big ${on ? 'on' : ''}`} onClick={() => toggleLeague(l.id)} aria-pressed={on}>
              {on ? '★ ' : ''}
              {l.ar}
            </button>
          );
        })}
      </div>
    </>
  );
}
