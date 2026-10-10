import type { ReactNode } from 'react';

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label="جارٍ التحميل">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function Empty({ icon = '⚽', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
  return (
    <div className="empty error">
      <div className="empty-icon">⚠️</div>
      <h3>تعذّر تحميل البيانات</h3>
      <p className="empty-body">{msg}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}

export function StaleBanner({ show }: { show?: boolean }) {
  if (!show) return null;
  return <div className="banner warn">⏳ قد لا تكون البيانات محدّثة (تم عرض آخر نسخة محفوظة)</div>;
}
