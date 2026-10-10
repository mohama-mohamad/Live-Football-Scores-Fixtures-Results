import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useLive, useMatches } from '../api/client';
import { LeagueSection, groupByLeague, sortGroups } from '../components/LeagueSection';
import { MatchCard } from '../components/MatchCard';
import { Empty, ErrorBox, Loading, StaleBanner } from '../components/States';
import { todayKey } from '../lib/format';
import { isIOS, isStandalone } from '../lib/push';
import { useStore } from '../lib/store';

function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('koora:install-hint') === '1';
    } catch {
      return false;
    }
  });
  if (hidden || !isIOS() || isStandalone()) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem('koora:install-hint', '1');
    } catch {
      /* لا شيء */
    }
  };
  return (
    <div className="banner info">
      <span>📲 ثبّت التطبيق على الشاشة الرئيسية لتصلك تنبيهات الأهداف.</span>
      <Link to="/settings">الطريقة</Link>
      <button className="banner-close" onClick={close} aria-label="إغلاق">
        ✕
      </button>
    </div>
  );
}

export function LivePage() {
  const live = useLive();
  const today = useMatches(todayKey());
  const favLeagues = useStore((s) => s.favLeagues);

  const upcoming = (today.data?.data ?? []).filter((m) => m.status === 'scheduled' && Date.parse(m.kickoff) > Date.now()).slice(0, 6);

  return (
    <>
      <InstallHint />
      <StaleBanner show={live.data?.stale} />
      {live.isPending ? (
        <Loading />
      ) : live.isError ? (
        <ErrorBox error={live.error} onRetry={() => live.refetch()} />
      ) : live.data.data.length === 0 ? (
        <Empty icon="📺" title="لا توجد مباريات مباشرة الآن">
          تابع <Link to="/fixtures">جدول مباريات اليوم</Link>
        </Empty>
      ) : (
        <>
          <div className="section-title">
            <span className="pulse" /> {live.data.data.length} مباراة جارية الآن
          </div>
          {sortGroups(groupByLeague(live.data.data), favLeagues).map((g) => (
            <LeagueSection key={g.leagueId} matches={g.matches} />
          ))}
        </>
      )}

      {upcoming.length > 0 && (
        <section className="league-section">
          <header className="league-head plain">
            <span className="league-name">قادمة اليوم</span>
            <Link to="/fixtures" className="more">
              الكل
            </Link>
          </header>
          <div className="cards">
            {upcoming.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
