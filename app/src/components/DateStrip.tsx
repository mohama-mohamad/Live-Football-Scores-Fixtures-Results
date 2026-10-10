import { useEffect, useRef } from 'react';
import { addDays, dayLabel, todayKey } from '../lib/format';

// شريط أفقي لاختيار اليوم
// reverse: الأحدث أولاً (للنتائج: اليوم ثم أمس...)
export function DateStrip({ value, onChange, from, to, reverse }: { value: string; onChange: (d: string) => void; from: number; to: number; reverse?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const today = todayKey();
  const days = Array.from({ length: to - from + 1 }, (_, i) => addDays(today, from + i));
  if (reverse) days.reverse();

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [value]);

  return (
    <div className="date-strip" ref={ref} role="tablist" aria-label="اختر اليوم">
      {days.map((d) => {
        const l = dayLabel(d);
        return (
          <button key={d} role="tab" aria-selected={d === value} className={`date-chip ${d === value ? 'on' : ''}`} onClick={() => onChange(d)}>
            <span className="top">{l.top}</span>
            <span className="bottom">{l.bottom}</span>
          </button>
        );
      })}
    </div>
  );
}
