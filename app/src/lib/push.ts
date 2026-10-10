// تفعيل/إيقاف تنبيهات Web Push ومزامنة التفضيلات مع الخادم
import type { PushPrefs } from '../../../shared/types';
import { api } from '../api/client';
import { getState, subscribe as onStoreChange, updateSettings } from './store';

export type PushSupport =
  | 'supported'
  | 'ios-needs-install' // آيفون: يجب إضافة التطبيق للشاشة الرئيسية أولاً
  | 'ios-too-old' // آيفون بإصدار أقدم من 16.4
  | 'unsupported';

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function iosVersion(): number | null {
  const m = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  return m ? Number(m[1]) + Number(m[2]) / 100 : null;
}

export function pushSupport(): PushSupport {
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIOS()) {
    const v = iosVersion();
    if (v != null && v < 16.04) return 'ios-too-old';
    if (!isStandalone()) return 'ios-needs-install';
  }
  return hasApi ? 'supported' : 'unsupported';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function currentPrefs(): PushPrefs {
  const s = getState();
  return { teams: s.favTeams.map((t) => t.id), leagues: s.favLeagues, events: s.settings.events };
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function getSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null;
  return (await registration()).pushManager.getSubscription();
}

async function sendToServer(sub: PushSubscription) {
  await api('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), prefs: currentPrefs() }),
  });
}

// يجب استدعاؤها من ضغطة زر (شرط في iOS)
export async function enablePush(vapidPublicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'denied' : 'dismissed');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
  await sendToServer(sub);
  updateSettings({ notificationsEnabled: true });
}

export async function disablePush(): Promise<void> {
  const sub = await getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe();
  }
  updateSettings({ notificationsEnabled: false });
}

export async function sendTest(): Promise<void> {
  const sub = await getSubscription();
  if (!sub) throw new Error('no-subscription');
  await api('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
}

// عند فتح التطبيق وعند تغيير المفضلة: نحدّث التفضيلات على الخادم
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSent = '';
export function startPushSync() {
  const sync = async () => {
    if (!getState().settings.notificationsEnabled || Notification.permission !== 'granted') return;
    const sub = await getSubscription();
    if (!sub) return;
    const key = JSON.stringify([sub.endpoint, currentPrefs()]);
    if (key === lastSent) return;
    try {
      await sendToServer(sub);
      lastSent = key;
    } catch (e) {
      console.warn('push sync failed', e);
    }
  };
  if (pushSupport() !== 'supported') return;
  void sync();
  onStoreChange(() => {
    clearTimeout(timer);
    timer = setTimeout(sync, 800);
  });
}
