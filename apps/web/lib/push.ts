import { apiFetch } from './api';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const { publicKey, configured } = await apiFetch<{ publicKey: string | null; configured: boolean }>('/notifications/push/vapid-public-key');
  if (!configured || !publicKey) return { ok: false, reason: 'not_configured' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'permission_denied' };

  const reg = await navigator.serviceWorker.register('/sw.js');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = sub.toJSON();
  await apiFetch('/notifications/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } }),
  });
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await apiFetch('/notifications/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) });
  await sub.unsubscribe();
}
