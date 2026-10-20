import { deletePushSubscription, fetchPushPublicKey, fetchPushStatus, savePushSubscription } from '../api/push';

/**
 * Why phone alerts can or can't be turned on here:
 * - insecure:    plain http:// — browsers only allow push on HTTPS
 * - install:     iPhone/iPad Safari tab — push works only from the Home Screen app
 * - unsupported: no service worker / Push API
 * - denied:      the user blocked notifications for the app
 * - ok:          ready to ask
 */
export type PushSupport = 'ok' | 'insecure' | 'install' | 'unsupported' | 'denied';

export interface PushEnv {
  secure: boolean;
  ios: boolean;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPush: boolean;
  permission: NotificationPermission | 'unavailable';
}

export function currentEnv(): PushEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    secure: window.isSecureContext,
    ios,
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPush: 'PushManager' in window && 'Notification' in window,
    permission: 'Notification' in window ? Notification.permission : 'unavailable',
  };
}

export function pushSupport(env: PushEnv): PushSupport {
  if (!env.secure) return 'insecure';
  if (env.ios && !env.standalone) return 'install';
  if (!env.hasServiceWorker || !env.hasPush) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  return 'ok';
}

/** VAPID keys are base64url; PushManager wants the raw bytes. */
export function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Register the (cache-free) service worker. Done at startup on HTTPS so it's ready
 * before the user taps "Turn on alerts" — iOS only shows the permission prompt
 * when it's requested straight from the tap.
 */
export function registerServiceWorker(): void {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* alerts just stay unavailable */
  });
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** Is THIS device registered with the server for the signed-in user? */
export async function isSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? fetchPushStatus(sub.endpoint) : false;
}

/**
 * Ask permission (must be the first await in the tap handler) and subscribe.
 * Returns the resulting permission.
 */
export async function enablePush(): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = await fetchPushPublicKey();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) as BufferSource });
  }
  await savePushSubscription(sub.toJSON());
  return permission;
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
