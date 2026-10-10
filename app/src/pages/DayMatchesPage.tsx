import { useSearchParams } from 'react-router-dom';
import { useMatches, useMeta } from '../api/client';
import { DateStrip } from '../components/DateStrip';
import { LeagueSection, groupByLeague, sortGroups } from '../components/LeagueSection';
import { Empty, ErrorBox, Loading, StaleBanner } from '../components/States';
import { dayTitle, isFinished, todayKey } from '../lib/format';
import { isFavTeam, useStore } from '../lib/store';

// "المباريات": اليوم وحتى 7 أيام قادمة (غير المنتهية)
// "النتائج": اليوم وحتى 7 أيام سابقة (المنتهية)
export function DayMatchesPage({ mode }: { mode: 'fixtures' | 'results' }) {
  const [params, setParams] = useSearchParams();
  const date = params.get('d') ?? todayKey();
  const onlyFav = params.get('fav') === '1';
  const q = useMatches(date);
  const favTeams = useStore((s) => s.favTeams);
  const favLeagues = useStore((s) => s.favLeagues);
  // عدد الأيام المتاحة حسب خطة البيانات (المجانية: أمس واليوم وغداً)
  const features = useMeta().data?.features;
  const span = Math.min(7, features?.dateWindow ?? 7);
  // خارج نطاق API-Football تظهر بطولات football-data.org فقط
  const afWindow = features?.afWindow ?? 31;
  const partial = !!features?.secondary && Math.abs(Math.round((Date.parse(date) - Date.parse(todayKey())) / 86_400_000)) > afWindow;

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v == null ? next.delete(k) : next.set(k, v));
    setParams(next, { replace: true });
  };

  let list = (q.data?.data ?? []).filter((m) => (mode === 'results' ? isFinished(m.status) : !isFinished(m.status)));
  if (onlyFav) {
    list = list.filter((m) => isFavTeam(favTeams, m.home) || isFavTeam(favTeams, m.away) || favLeagues.includes(m.league.id));
  }

  return (
    <>
      <DateStrip value={date} onChange={(d) => set({ d })} from={mode === 'results' ? -span : 0} to={mode === 'results' ? 0 : span} reverse={mode === 'results'} />
      <div className="filter-row">
        <span className="day-title">{dayTitle(date)}</span>
        <div className="chips">
          <button className={`chip ${!onlyFav ? 'on' : ''}`} onClick={() => set({ fav: null })}>
            الكل
          </button>
          <button className={`chip ${onlyFav ? 'on' : ''}`} onClick={() => set({ fav: '1' })}>
            ★ المفضلة
          </button>
        </div>
      </div>
      {partial && (
        <div className="banner info">
          <span>في هذا اليوم تظهر البطولات الأوروبية الكبرى فقط (باقي البطولات متاحة من أمس إلى غد في الخطة المجانية).</span>
        </div>
      )}
      <StaleBanner show={q.data?.stale} />
      {q.isPending ? (
        <Loading rows={6} />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <Empty icon={mode === 'results' ? '📋' : '🗓️'} title={mode === 'results' ? 'لا توجد نتائج لهذا اليوم' : 'لا توجد مباريات قادمة في هذا اليوم'}>
          {onlyFav ? 'جرّب عرض كل المباريات أو أضف فرقاً ودوريات إلى المفضلة' : 'اختر يوماً آخر من الشريط بالأعلى'}
        </Empty>
      ) : (
        sortGroups(groupByLeague(list), favLeagues).map((g) => <LeagueSection key={g.leagueId} matches={g.matches} />)
      )}
    </>
  );
}
