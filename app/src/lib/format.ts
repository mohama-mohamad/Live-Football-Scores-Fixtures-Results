import type { Match, MatchStatus } from '../../../shared/types';

// أرقام لاتينية (0-9) لسهولة قراءة النتائج، مع نصوص عربية
const LOCALE = 'ar-u-nu-latn';
export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const shortDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
const fullFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatFullDate = (iso: string) => fullFmt.format(new Date(iso));

// YYYY-MM-DD بالتوقيت المحلي
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + n));
}

export const todayKey = () => localDateKey(new Date());

export function dayLabel(key: string): { top: string; bottom: string } {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const t = todayKey();
  const rel = key === t ? 'اليوم' : key === addDays(t, -1) ? 'أمس' : key === addDays(t, 1) ? 'غداً' : null;
  return { top: rel ?? shortDayFmt.format(date), bottom: dateFmt.format(date) };
}

export function dayTitle(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${dayFmt.format(date)} ${dateFmt.format(date)}`;
}

export const isLive = (s: MatchStatus) => s === 'live' || s === 'halftime' || s === 'penalties';
export const isFinished = (s: MatchStatus) => s === 'finished';

export function statusLabel(m: Match): string {
  switch (m.status) {
    case 'live':
      return m.minute != null ? `${m.minute}'` : 'مباشر';
    case 'halftime':
      return m.statusShort === 'BT' ? 'استراحة' : 'بين الشوطين';
    case 'penalties':
      return 'ركلات الترجيح';
    case 'finished':
      return m.statusShort === 'AET' ? 'بعد التمديد' : m.statusShort === 'PEN' ? 'بعد الترجيح' : 'انتهت';
    case 'postponed':
      return 'مؤجلة';
    case 'cancelled':
      return m.statusShort === 'SUSP' || m.statusShort === 'INT' ? 'موقوفة' : 'ملغاة';
    default:
      return formatTime(m.kickoff);
  }
}

export const STAT_LABELS: Record<string, string> = {
  possession: 'الاستحواذ',
  shots_total: 'التسديدات',
  shots_on: 'على المرمى',
  shots_off: 'خارج المرمى',
  shots_blocked: 'تسديدات محجوبة',
  corners: 'الركلات الركنية',
  offsides: 'التسلل',
  fouls: 'الأخطاء',
  yellow: 'البطاقات الصفراء',
  red: 'البطاقات الحمراء',
  saves: 'تصديات الحارس',
  passes: 'التمريرات',
  pass_accuracy: 'دقة التمرير',
  xg: 'الأهداف المتوقعة (xG)',
};

export function relativeUpdated(iso?: string): string {
  if (!iso) return '';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'الآن';
  const m = Math.round(s / 60);
  return m < 60 ? `قبل ${m} د` : `قبل ${Math.round(m / 60)} س`;
}
