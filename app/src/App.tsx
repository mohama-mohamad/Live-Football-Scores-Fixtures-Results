import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { BellIcon, CalendarIcon, LiveIcon, RefreshIcon, ResultsIcon, StarIcon, TrophyIcon, BackIcon } from './components/Icons';
import { dismissFavReset, syncProvider, useStore } from './lib/store';
import { useMeta } from './api/client';
import { LivePage } from './pages/LivePage';
import { DayMatchesPage } from './pages/DayMatchesPage';
import { LeaguesPage } from './pages/LeaguesPage';
import { LeaguePage } from './pages/LeaguePage';
import { MatchPage } from './pages/MatchPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { SettingsPage } from './pages/SettingsPage';

const TABS = [
  { to: '/', label: 'مباشر', icon: LiveIcon, end: true },
  { to: '/fixtures', label: 'المباريات', icon: CalendarIcon },
  { to: '/results', label: 'النتائج', icon: ResultsIcon },
  { to: '/leagues', label: 'البطولات', icon: TrophyIcon },
  { to: '/favorites', label: 'المفضلة', icon: StarIcon },
];

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'المباريات المباشرة'],
  [/^\/fixtures/, 'جدول المباريات'],
  [/^\/results/, 'النتائج'],
  [/^\/leagues/, 'البطولات'],
  [/^\/league\//, 'البطولة'],
  [/^\/match\//, 'تفاصيل المباراة'],
  [/^\/favorites/, 'المفضلة'],
  [/^\/settings/, 'التنبيهات والإعدادات'],
];

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') delete el.dataset.theme;
    else el.dataset.theme = theme;
  }, [theme]);
}

export function App() {
  useTheme();
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const fetching = useIsFetching();
  const notifOn = useStore((s) => s.settings.notificationsEnabled);
  const favReset = useStore((s) => s.favReset);
  const meta = useMeta();
  useEffect(() => {
    if (meta.data?.provider) syncProvider(meta.data.provider);
  }, [meta.data?.provider]);
  const title = TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? 'كورة لايف';
  const isDetail = /^\/(match|league)\//.test(loc.pathname) || loc.pathname === '/settings';

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          {isDetail ? (
            <button className="icon-btn" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} aria-label="رجوع">
              <BackIcon />
            </button>
          ) : (
            <span className="brand" aria-hidden>
              ⚽
            </span>
          )}
          <h1>{title}</h1>
          <div className="topbar-actions">
            <button className={`icon-btn ${fetching ? 'spin' : ''}`} onClick={() => qc.invalidateQueries()} aria-label="تحديث">
              <RefreshIcon width={21} height={21} />
            </button>
            <NavLink to="/settings" className="icon-btn bell" aria-label="التنبيهات">
              <BellIcon width={21} height={21} />
              {!notifOn && <span className="badge-dot" />}
            </NavLink>
          </div>
        </div>
      </header>

      <main className="content">
        {favReset && (
          <div className="banner warn">
            <span>
              تغيّر مصدر البيانات إلى البيانات الحقيقية، فمُسحت فرقك المفضلة القديمة. أضفها من جديد لتصلك تنبيهاتها: افتح أي مباراة لفريقك
              واضغط ★.
            </span>
            <Link to="/favorites" onClick={dismissFavReset}>
              حسناً
            </Link>
          </div>
        )}
        <Routes>
          <Route path="/" element={<LivePage />} />
          <Route path="/fixtures" element={<DayMatchesPage mode="fixtures" />} />
          <Route path="/results" element={<DayMatchesPage mode="results" />} />
          <Route path="/leagues" element={<LeaguesPage />} />
          <Route path="/league/:id" element={<LeaguePage />} />
          <Route path="/match/:id" element={<MatchPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<LivePage />} />
        </Routes>
      </main>

      <nav className="tabbar" aria-label="التنقل الرئيسي">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}>
            <Icon width={23} height={23} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
