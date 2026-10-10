// الدوريات المتابَعة افتراضياً. المعرّفات (id) هي معرّفات API-Football.
// لإضافة دوري: أضِف سطراً هنا بمعرّفه واسمه العربي.
// تحقّق من المعرّف من لوحة API-Football أو عبر /leagues?search=...

export interface LeagueConfig {
  id: number;
  ar: string;
  country: string;
  priority: number; // الأصغر يظهر أولاً
}

export const LEAGUES: LeagueConfig[] = [
  { id: 307, ar: 'دوري روشن السعودي', country: 'السعودية', priority: 1 },
  { id: 2, ar: 'دوري أبطال أوروبا', country: 'أوروبا', priority: 2 },
  { id: 39, ar: 'الدوري الإنجليزي الممتاز', country: 'إنجلترا', priority: 3 },
  { id: 140, ar: 'الدوري الإسباني', country: 'إسبانيا', priority: 4 },
  { id: 135, ar: 'الدوري الإيطالي', country: 'إيطاليا', priority: 5 },
  { id: 78, ar: 'الدوري الألماني', country: 'ألمانيا', priority: 6 },
  { id: 61, ar: 'الدوري الفرنسي', country: 'فرنسا', priority: 7 },
  { id: 233, ar: 'الدوري المصري الممتاز', country: 'مصر', priority: 8 },
  { id: 17, ar: 'دوري أبطال آسيا للنخبة', country: 'آسيا', priority: 9 },
  { id: 12, ar: 'دوري أبطال أفريقيا', country: 'أفريقيا', priority: 10 },
  { id: 3, ar: 'الدوري الأوروبي', country: 'أوروبا', priority: 11 },
  { id: 848, ar: 'دوري المؤتمر الأوروبي', country: 'أوروبا', priority: 12 },
  { id: 200, ar: 'الدوري المغربي (البطولة الاحترافية)', country: 'المغرب', priority: 13 },
  { id: 301, ar: 'دوري أدنوك للمحترفين', country: 'الإمارات', priority: 14 },
  { id: 305, ar: 'دوري نجوم قطر', country: 'قطر', priority: 15 },
  { id: 1, ar: 'كأس العالم', country: 'العالم', priority: 0 },
  { id: 6, ar: 'كأس أمم أفريقيا', country: 'أفريقيا', priority: 0 },
  { id: 7, ar: 'كأس آسيا', country: 'آسيا', priority: 0 },
  { id: 4, ar: 'كأس أمم أوروبا', country: 'أوروبا', priority: 0 },
];

export const LEAGUE_IDS = new Set(LEAGUES.map((l) => l.id));

export function leagueConfig(id: number): LeagueConfig | undefined {
  return LEAGUES.find((l) => l.id === id);
}

export function leagueName(id: number, fallback: string): string {
  return leagueConfig(id)?.ar ?? fallback;
}

export function leaguePriority(id: number): number {
  return leagueConfig(id)?.priority ?? 99;
}
