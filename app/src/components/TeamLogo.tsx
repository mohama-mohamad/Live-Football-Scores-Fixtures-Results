import { useState } from 'react';

// شعار الفريق أو الدوري، ومع عدم توفره: دائرة ملوّنة بالحرف الأول
export function Logo({ src, name, size = 28, kind = 'team' }: { src?: string; name: string; size?: number; kind?: 'team' | 'league' }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img className="logo" src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />;
  }
  if (kind === 'league') {
    return (
      <span className="logo logo-fallback league" style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>
        🏆
      </span>
    );
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const letter = name.replace(/^ال/, '').trim().charAt(0) || '?';
  return (
    <span className="logo logo-fallback" style={{ width: size, height: size, fontSize: size * 0.45, background: `hsl(${h % 360} 55% 42%)` }} aria-hidden>
      {letter}
    </span>
  );
}
