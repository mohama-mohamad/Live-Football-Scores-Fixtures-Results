export const DAY_MS = 86_400_000;

export const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// فرق التوقيت (بالميلي ثانية) للمنطقة الزمنية عند لحظة معيّنة
function tzOffset(tz: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at / 1000) * 1000;
}

// بداية ونهاية يوم محلي (YYYY-MM-DD) في منطقة زمنية، كلحظات UTC
export function localDayRange(date: string, tz: string): [number, number] {
  const midnight = (d: string) => {
    const naive = Date.parse(`${d}T00:00:00Z`);
    let t = naive - tzOffset(tz, naive);
    t = naive - tzOffset(tz, t); // تصحيح ثانٍ لأيام تغيير التوقيت الصيفي
    return t;
  };
  const next = utcDate(Date.parse(`${date}T00:00:00Z`) + DAY_MS);
  return [midnight(date), midnight(next)];
}

// أيام UTC التي يتقاطع معها المدى [start, end)
export function utcDatesCovering(start: number, end: number): string[] {
  const out: string[] = [];
  for (let d = Math.floor(start / DAY_MS); d <= Math.floor((end - 1) / DAY_MS); d++) out.push(utcDate(d * DAY_MS));
  return out;
}
