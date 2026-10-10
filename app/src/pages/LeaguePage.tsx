import { useParams, useSearchParams } from 'react-router-dom';
import { leagueConfig, leagueName } from '../../../shared/leagues';
import { teamName } from '../../../shared/teams';
import type { Match, Standings } from '../../../shared/types';
import { useLeagueMatches, useMatches, useMeta, useStandings } from '../api/client';
import { StarIcon } from '../components/Icons';
import { MatchCard } from '../components/MatchCard';
import { Logo } from '../components/TeamLogo';
import { Empty, ErrorBox, Loading, StaleBanner } from '../components/States';
import { addDays, formatFullDate, isFinished, todayKey } from '../lib/format';
import { isFavTeam, toggleLeague, toggleTeam, useStore } from '../lib/store';

const TABS = [
  { key: 'table', label: 'الترتيب' },
  { key: 'results', label: 'النتائج' },
  { key: 'next', label: 'القادمة' },
] as const;

function Table({ data }: { data: Standings }) {
  const favTeams = useStore((s) => s.favTeams);
  return (
    <>
      {data.groups.map((g) => (
        <section className="table-card" key={g.name}>
          {data.groups.length > 1 && <h3 className="group-name">{g.name}</h3>}
          <table className="standings">
            <thead>
              <tr>
                <th>#</th>
                <th className="team-col">الفريق</th>
                <th title="لعب">ل</th>
                <th title="فوز">ف</th>
                <th title="تعادل">ت</th>
                <th title="خسارة">خ</th>
                <th title="فارق الأهداف">±</th>
                <th title="النقاط">ن</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => {
                const fav = isFavTeam(favTeams, r.team);
                return (
                  <tr key={r.team.id} className={fav ? 'fav' : ''}>
                    <td className="rank">{r.rank}</td>
                    <td className="team-col">
                      <button className="team-cell" onClick={() => toggleTeam(r.team)} aria-label={`${teamName(r.team.name)} — ${fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}`}>
                        <Logo src={r.team.logo} name={teamName(r.team.name)} size={20} />
                        <span>{teamName(r.team.name)}</span>
                        {fav && <span className="fav-dot">★</span>}
                      </button>
                    </td>
                    <td>{r.played}</td>
                    <td>{r.win}</td>
                    <td>{r.draw}</td>
                    <td>{r.lose}</td>
                    <td dir="ltr">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                    <td className="pts">{r.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
      <p className="hint">اضغط على اسم الفريق لإضافته إلى المفضلة وتلقي تنبيهاته.</p>
    </>
  );
}

function MatchList({ list, empty }: { list: Match[]; empty: string }) {
  if (!list.length) return <Empty title={empty} />;
  let lastDay = '';
  return (
    <div className="cards">
      {list.map((m) => {
        const day = formatFullDate(m.kickoff);
        const head = day !== lastDay ? <div className="day-sep">{day}</div> : null;
        lastDay = day;
        return (
          <div key={m.id}>
            {head}
            <MatchCard m={m} />
          </div>
        );
      })}
    </div>
  );
}

// عندما لا تتيح الخطة جداول الترتيب: نعرض مباريات البطولة من أمس إلى غد
function RecentLeagueMatches({ id }: { id: number }) {
  const today = todayKey();
  const qs = [useMatches(addDays(today, -1)), useMatches(today), useMatches(addDays(today, 1))];
  if (qs.some((q) => q.isPending)) return <Loading />;
  const all = qs.flatMap((q) => q.data?.data ?? []).filter((m) => m.league.id === id);
  const done = all.filter((m) => isFinished(m.status)).reverse();
  const next = all.filter((m) => !isFinished(m.status));
  return (
    <>
      <div className="banner info">
        <span>جدول الترتيب غير متاح لهذه البطولة في خطة البيانات الحالية. تظهر هنا مباريات البطولة من أمس إلى غد.</span>
      </div>
      <h2 className="section-title">القادمة والجارية</h2>
      <MatchList list={next} empty="لا توجد مباريات اليوم أو غداً" />
      <h2 className="section-title">آخر النتائج</h2>
      <MatchList list={done} empty="لا توجد نتائج من أمس أو اليوم" />
    </>
  );
}

export function LeaguePage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as (typeof TABS)[number]['key']) ?? 'table';
  const meta = useMeta();
  const f = meta.data?.features;
  const standingsOn = f?.standingsLeagues ? f.standingsLeagues.includes(id) : (f?.standings ?? true);
  const standings = useStandings(id, standingsOn && meta.isSuccess);
  const matches = useLeagueMatches(id, standingsOn && meta.isSuccess);
  const favs = useStore((s) => s.favLeagues);
  const fav = favs.includes(id);
  const name = leagueName(id, standings.data?.data.league.name ?? 'البطولة');

  return (
    <>
      <div className="league-hero">
        <Logo src={`https://media.api-sports.io/football/leagues/${id}.png`} name={name} size={48} kind="league" />
        <div className="grow">
          <h2>{name}</h2>
          <div className="list-sub">
            {leagueConfig(id)?.country}
            {standings.data?.data.league.season ? ` • موسم ${standings.data.data.league.season}` : ''}
          </div>
        </div>
        <button className={`icon-btn star ${fav ? 'on' : ''}`} onClick={() => toggleLeague(id)} aria-label={fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'} aria-pressed={fav}>
          <StarIcon filled={fav} />
        </button>
      </div>
      {meta.isSuccess && !standingsOn ? (
        <RecentLeagueMatches id={id} />
      ) : (
      <>
      <div className="segmented" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setParams({ tab: t.key }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'table' ? (
        standings.isPending ? (
          <Loading rows={8} />
        ) : standings.isError ? (
          <ErrorBox error={standings.error} onRetry={() => standings.refetch()} />
        ) : (
          <>
            <StaleBanner show={standings.data.stale} />
            <Table data={standings.data.data} />
          </>
        )
      ) : matches.isPending ? (
        <Loading />
      ) : matches.isError ? (
        <ErrorBox error={matches.error} onRetry={() => matches.refetch()} />
      ) : tab === 'results' ? (
        <MatchList list={matches.data.data.last} empty="لا توجد نتائج حديثة" />
      ) : (
        <MatchList list={matches.data.data.next} empty="لا توجد مباريات قادمة" />
      )}
      </>
      )}
    </>
  );
}
