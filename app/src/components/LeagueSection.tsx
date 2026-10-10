import { Link } from 'react-router-dom';
import type { Match } from '../../../shared/types';
import { leagueConfig, leagueName } from '../../../shared/leagues';
import { MatchCard } from './MatchCard';
import { Logo } from './TeamLogo';
import { StarIcon } from './Icons';
import { toggleLeague, useStore } from '../lib/store';

export function groupByLeague(list: Match[]): { leagueId: number; matches: Match[] }[] {
  const groups: { leagueId: number; matches: Match[] }[] = [];
  for (const m of list) {
    const last = groups.at(-1);
    if (last && last.leagueId === m.league.id) last.matches.push(m);
    else groups.push({ leagueId: m.league.id, matches: [m] });
  }
  return groups;
}

// ترتيب المجموعات: الدوريات المفضلة أولاً
export function sortGroups<T extends { leagueId: number }>(groups: T[], favLeagues: number[]): T[] {
  return [...groups].sort((a, b) => Number(favLeagues.includes(b.leagueId)) - Number(favLeagues.includes(a.leagueId)));
}

export function LeagueSection({ matches }: { matches: Match[] }) {
  const lg = matches[0].league;
  const favs = useStore((s) => s.favLeagues);
  const fav = favs.includes(lg.id);
  const name = leagueName(lg.id, lg.name);
  return (
    <section className="league-section">
      <header className="league-head">
        <Link to={`/league/${lg.id}`} className="league-link">
          <Logo src={lg.logo} name={name} size={22} kind="league" />
          <span className="league-name">{name}</span>
          {leagueConfig(lg.id)?.country && <span className="league-country">{leagueConfig(lg.id)!.country}</span>}
        </Link>
        <button className={`icon-btn star ${fav ? 'on' : ''}`} onClick={() => toggleLeague(lg.id)} aria-label={fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'} aria-pressed={fav}>
          <StarIcon filled={fav} width={20} height={20} />
        </button>
      </header>
      <div className="cards">
        {matches.map((m) => (
          <MatchCard key={m.id} m={m} />
        ))}
      </div>
    </section>
  );
}
