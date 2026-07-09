'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconBell } from './icons';
import { apiFetch, type NotificationItem } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const TYPE_ICON: Record<string, string> = {
  STUDENT_ABSENT: '🚫', BELOW_80: '⚠️', ATTENDANCE_SUBMITTED: '✅',
  CLASS_CANCELLED: '📅', ACTIVITY: '🎉', SYSTEM: '🔔',
};

export default function NotificationBell() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<{ unread: number; items: NotificationItem[] }>('/notifications');
      setItems(d.items); setUnread(d.unread);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      apiFetch<{ unread: number }>('/notifications/unread-count').then((d) => setUnread(d.unread)).catch(() => {});
    }, 20000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await load();
  }
  async function markRead(id: string, alreadyRead: boolean) {
    if (alreadyRead) return;
    try {
      const d = await apiFetch<{ unread: number }>(`/notifications/${id}/read`, { method: 'PATCH' });
      setUnread(d.unread);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    } catch { /* ignore */ }
  }
  async function markAll() {
    try {
      await apiFetch('/notifications/read-all', { method: 'PATCH' });
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    } catch { /* ignore */ }
  }

  const fmt = (iso: string) => new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="glass hairline icon-btn" style={{ width: 40, height: 40, position: 'relative' }} aria-label={t('notif.title')} onClick={toggle}>
        <IconBell />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="glass glass-strong rise" style={{ position: 'absolute', top: 48, right: 0, width: 340, maxHeight: 440, overflowY: 'auto', padding: 12, zIndex: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{t('notif.title')}</div>
            {unread > 0 && <button onClick={markAll} style={{ border: 'none', background: 'transparent', color: 'var(--brand)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{t('notif.markAll')}</button>}
          </div>
          {items.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>{t('notif.empty')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((n) => (
                <button key={n.id} onClick={() => markRead(n.id, !!n.readAt)}
                  className="glass hairline"
                  style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 12, cursor: n.readAt ? 'default' : 'pointer', display: 'flex', gap: 10, border: n.readAt ? undefined : '1px solid var(--brand-2)', opacity: n.readAt ? 0.7 : 1 }}>
                  <span style={{ fontSize: 18 }}>{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                    {n.body && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{n.body}</div>}
                    <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{fmt(n.createdAt)}</div>
                  </div>
                  {!n.readAt && <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--brand)', flexShrink: 0, marginTop: 4 }} />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
