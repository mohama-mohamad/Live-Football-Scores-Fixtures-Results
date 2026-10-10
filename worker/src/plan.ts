// خطة المتابعة المباشرة: كم مرة نسأل مزوّد البيانات؟
// مباريات الفرق المفضلة تحصل على أسرع تحديث يسمح به الرصيد المتبقي،
// وباقي المباريات تتقاسم ما يتبقى (بحد أدنى LIVE_POLL_SECONDS).
// كل طلب "مباشر" يجلب كل المباريات الجارية دفعة واحدة، لذلك التكلفة تعتمد على عدد مرات السؤال فقط.
import type { Match } from '../../shared/types';

export interface TimeWindow {
  start: number;
  end: number;
}

// المدة المتوقعة من صافرة البداية حتى النهاية (شوطان + استراحة + وقت بدل ضائع)
export const MATCH_MS = 125 * 60_000;
const BEFORE_KICKOFF_MS = 2 * 60_000;

const done = (m: Match) => m.status === 'finished' || m.status === 'cancelled' || m.status === 'postponed';
const inPlay = (m: Match) => m.status === 'live' || m.status === 'halftime' || m.status === 'penalties';

// الفترة الزمنية التي نحتاج فيها متابعة المباراة (أو null إن انتهت)
export function matchWindow(m: Match, now: number): TimeWindow | null {
  if (done(m)) return null;
  const ko = Date.parse(m.kickoff);
  let end = ko + MATCH_MS;
  // مباراة ما زالت جارية بعد الوقت المتوقع (وقت إضافي/ترجيح): نمدّد ربع ساعة
  if (inPlay(m) && end < now + 15 * 60_000) end = now + 15 * 60_000;
  if (end <= now) return null;
  return { start: ko - BEFORE_KICKOFF_MS, end };
}

// طول اتحاد الفترات (بالدقائق) من لحظة from فصاعداً
export function mergedMinutes(windows: TimeWindow[], from: number): number {
  const parts = windows
    .map((w) => ({ start: Math.max(w.start, from), end: w.end }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const w of parts) {
    if (w.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = w.start;
      curEnd = w.end;
    } else curEnd = Math.max(curEnd, w.end);
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total / 60_000;
}

export const activeAt = (windows: TimeWindow[], t: number) => windows.some((w) => w.start <= t && t < w.end);

export interface LivePlan {
  mode: 'fast' | 'slow' | 'idle' | 'budget';
  fastSec: number; // فترة التحديث أثناء مباريات الفرق المفضلة
  slowSec: number; // فترة التحديث لباقي المباريات
  remaining: number; // الطلبات المتبقية اليوم للمتابعة المباشرة
}

export function computePlan(opts: {
  favWindows: TimeWindow[];
  allWindows: TimeWindow[];
  remaining: number;
  now: number;
  slowFloorSec: number;
  fastFloorSec?: number;
}): LivePlan {
  const { favWindows, allWindows, now, slowFloorSec } = opts;
  const fastFloorSec = opts.fastFloorSec ?? 60;
  // نحسب نحو 10% زيادة لطلبات تأكيد نهاية المباريات
  const budget = Math.max(0, opts.remaining) / 1.1;
  const favMin = mergedMinutes(favWindows, now);
  const otherMin = Math.max(0, mergedMinutes([...allWindows, ...favWindows], now) - favMin);

  let fastSec: number;
  let left: number;
  if (favMin <= 0) {
    fastSec = fastFloorSec;
    left = budget;
  } else if (favMin * (60 / fastFloorSec) <= budget * 0.7) {
    // الرصيد يكفي لتحديث كل دقيقة طوال مباريات المفضلة
    fastSec = fastFloorSec;
    left = budget - favMin * (60 / fastFloorSec);
  } else {
    // 70% من الرصيد للمفضلة، والباقي لغيرها
    fastSec = Math.ceil((favMin * 60) / Math.max(budget * 0.7, 0.01));
    left = budget * 0.3;
  }
  let slowSec = otherMin > 0 ? Math.max(slowFloorSec, Math.ceil((otherMin * 60) / Math.max(left, 0.01))) : slowFloorSec;
  fastSec = Math.max(fastFloorSec, Math.min(fastSec, slowSec));
  slowSec = Math.max(slowSec, fastSec);

  let mode: LivePlan['mode'];
  if (opts.remaining <= 0) mode = 'budget';
  else if (activeAt(favWindows, now)) mode = 'fast';
  else if (activeAt(allWindows, now)) mode = 'slow';
  else mode = 'idle';
  return { mode, fastSec, slowSec, remaining: opts.remaining };
}
