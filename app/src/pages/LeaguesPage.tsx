import { Link } from 'react-router-dom';
import { LEAGUES } from '../../../shared/leagues';
import { StarIcon } from '../components/Icons';
import { Logo } from '../components/TeamLogo';
import { toggleLeague, useStore } from '../lib/store';

export function LeaguesPage() {
  const favs = useStore((s) => s.favLeagues);
  const sorted = [...LEAGUES].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)) || a.priority - b.priority);
  return (
    <div className="list-card">
      {sorted.map((l) => {
        const fav = favs.includes(l.id);
        return (
          <div className="list-row" key={l.id}>
            <Link to={`/league/${l.id}`} className="list-link">
              <Logo src={`https://media.api-sports.io/football/leagues/${l.id}.png`} name={l.ar} size={30} kind="league" />
              <div>
                <div className="list-title">{l.ar}</div>
                <div className="list-sub">{l.country}</div>
              </div>
            </Link>
            <button className={`icon-btn star ${fav ? 'on' : ''}`} onClick={() => toggleLeague(l.id)} aria-label={fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'} aria-pressed={fav}>
              <StarIcon filled={fav} width={22} height={22} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
