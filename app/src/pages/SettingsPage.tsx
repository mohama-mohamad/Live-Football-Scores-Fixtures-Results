import { useEffect, useState } from 'react';
import type { NotificationEvents } from '../../../shared/types';
import { useMeta } from '../api/client';
import { PlusSquareIcon, ShareIcon } from '../components/Icons';
import { disablePush, enablePush, getSubscription, pushSupport, sendTest } from '../lib/push';
import { updateSettings, useStore } from '../lib/store';

const EVENTS: { key: keyof NotificationEvents; label: string; icon: string }[] = [
  { key: 'goal', label: 'الأهداف', icon: '⚽' },
  { key: 'kickoff', label: 'بداية المباراة', icon: '🟢' },
  { key: 'halftime', label: 'نهاية الشوط الأول', icon: '⏸️' },
  { key: 'fulltime', label: 'نهاية المباراة', icon: '🏁' },
  { key: 'redCard', label: 'البطاقات الحمراء', icon: '🟥' },
];

function InstallSteps() {
  return (
    <div className="steps">
      <p>
        على الآيفون تعمل التنبيهات فقط بعد <strong>إضافة التطبيق إلى الشاشة الرئيسية</strong> (يتطلب iOS 16.4 أو أحدث):
      </p>
      <ol>
        <li>
          افتح هذه الصفحة في <strong>Safari</strong>.
        </li>
        <li>
          اضغط زر المشاركة <ShareIcon width={18} height={18} className="inline-icon" /> أسفل الشاشة.
        </li>
        <li>
          اختر <strong>«إضافة إلى الشاشة الرئيسية»</strong> <PlusSquareIcon width={18} height={18} className="inline-icon" />.
        </li>
        <li>افتح التطبيق من أيقونته الجديدة، ثم ارجع إلى هذه الصفحة واضغط «تفعيل التنبيهات».</li>
      </ol>
    </div>
  );
}

// "كل 3 دقائق تقريباً" / "كل 20 ثانية"
function every(sec: number): string {
  if (sec < 60) return `كل ${Math.round(sec)} ثانية`;
  const min = Math.round(sec / 60);
  return min === 1 ? 'كل دقيقة' : min === 2 ? 'كل دقيقتين' : min <= 10 ? `كل ${min} دقائق تقريباً` : `كل ${min} دقيقة تقريباً`;
}

export function SettingsPage() {
  const meta = useMeta();
  const settings = useStore((s) => s.settings);
  const favCount = useStore((s) => s.favTeams.length + s.favLeagues.length);
  const support = pushSupport();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';

  useEffect(() => {
    getSubscription()
      .then((s) => setSubscribed(!!s))
      .catch(() => setSubscribed(false));
  }, [settings.notificationsEnabled]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: ok });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg({
        kind: 'err',
        text:
          m === 'denied'
            ? 'تم رفض الإذن. فعّله من الإعدادات ← الإشعارات ← كورة لايف.'
            : m === 'dismissed'
              ? 'لم يتم منح الإذن بعد.'
              : m,
      });
    } finally {
      setBusy(false);
    }
  };

  const active = settings.notificationsEnabled && subscribed && permission === 'granted';
  const vapid = meta.data?.vapidPublicKey;

  return (
    <>
      <section className="panel">
        <h2>🔔 التنبيهات</h2>
        {support === 'ios-needs-install' ? (
          <InstallSteps />
        ) : support === 'ios-too-old' ? (
          <p className="muted">إصدار iOS لديك لا يدعم تنبيهات تطبيقات الويب. حدّث جهازك إلى iOS 16.4 أو أحدث.</p>
        ) : support === 'unsupported' ? (
          <p className="muted">هذا المتصفح لا يدعم التنبيهات.</p>
        ) : permission === 'denied' ? (
          <p className="muted">التنبيهات محظورة. فعّلها من إعدادات الجهاز ← الإشعارات ← كورة لايف، ثم أعد فتح التطبيق.</p>
        ) : meta.isSuccess && !vapid ? (
          <p className="muted">التنبيهات غير مفعّلة على الخادم بعد (مفاتيح VAPID غير مضبوطة).</p>
        ) : active ? (
          <>
            <p className="status-line ok">✅ التنبيهات مفعّلة على هذا الجهاز</p>
            {favCount === 0 && <p className="banner warn">لم تختر أي فريق أو بطولة بعد — أضفها من صفحة المفضلة حتى تصلك التنبيهات.</p>}
            <div className="btn-row">
              <button className="btn" disabled={busy} onClick={() => run(sendTest, 'تم إرسال تنبيه تجريبي، يُفترض أن يصلك خلال ثوانٍ.')}>
                إرسال تنبيه تجريبي
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => run(disablePush, 'تم إيقاف التنبيهات.')}>
                إيقاف التنبيهات
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">احصل على تنبيه فوري عند تسجيل هدف أو بداية ونهاية مباريات فرقك وبطولاتك المفضلة.</p>
            <button className="btn primary wide" disabled={busy || !vapid} onClick={() => run(() => enablePush(vapid!), 'تم تفعيل التنبيهات ✅')}>
              {busy ? 'جارٍ التفعيل…' : 'تفعيل التنبيهات'}
            </button>
          </>
        )}
        {msg && <p className={`status-line ${msg.kind}`}>{msg.text}</p>}
      </section>

      <section className="panel">
        <h2>ماذا يصلني؟</h2>
        {EVENTS.map((e) => (
          <label className="toggle-row" key={e.key}>
            <span>
              {e.icon} {e.label}
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.events[e.key]}
              onChange={(ev) => updateSettings({ events: { ...settings.events, [e.key]: ev.target.checked } })}
            />
          </label>
        ))}
        <p className="hint">
          تصلك تنبيهات مباريات الفرق والبطولات الموجودة في المفضلة فقط. مباريات <strong>فرقك المفضلة</strong> تُتابَع بأسرع تحديث يسمح به رصيد
          الخطة، وباقي المباريات بتحديث أبطأ.
        </p>
      </section>

      <section className="panel">
        <h2>المظهر</h2>
        <div className="segmented">
          {(
            [
              ['auto', 'تلقائي'],
              ['light', 'فاتح'],
              ['dark', 'داكن'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={settings.theme === k ? 'on' : ''} onClick={() => updateSettings({ theme: k })}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel about">
        <h2>حول التطبيق</h2>
        <div className="info-row">
          <span className="muted">مصدر البيانات</span>
          <span>{meta.data ? (meta.data.provider === 'mock' ? 'بيانات تجريبية' : 'API-Football') : '…'}</span>
        </div>
        {meta.data?.limited && (
          <div className="info-row">
            <span className="muted">طلبات اليوم</span>
            <span dir="ltr">
              {meta.data.used} / {meta.data.limit}
            </span>
          </div>
        )}
        <div className="info-row">
          <span className="muted">تحديث مباريات فرقك المفضلة</span>
          <span>{meta.data ? every(meta.data.favPollSeconds) : '…'}</span>
        </div>
        <div className="info-row">
          <span className="muted">تحديث باقي المباريات</span>
          <span>{meta.data ? every(meta.data.pollSeconds) : '…'}</span>
        </div>
        <div className="info-row">
          <span className="muted">التوقيت</span>
          <span dir="ltr">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        </div>
      </section>
    </>
  );
}
