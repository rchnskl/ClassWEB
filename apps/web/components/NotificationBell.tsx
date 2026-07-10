'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconBell } from './icons';
import NotificationChannelsModal from './NotificationChannelsModal';
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
  const [pos, setPos] = useState<{ top: number; right: number; width: number } | null>(null);
  const [showChannels, setShowChannels] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

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

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(360, window.innerWidth - 24);
    // Anchor near the bell but clamp so the panel stays fully on-screen.
    const right = Math.min(Math.max(12, window.innerWidth - r.right), window.innerWidth - width - 12);
    setPos({ top: r.bottom + 8, right, width });
  }, []);

  // Reposition / close on scroll or resize while open.
  useEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    const onResize = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }, [open, place]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) { place(); await load(); }
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
    <>
      <button ref={btnRef} className="glass hairline icon-btn" style={{ width: 40, height: 40, position: 'relative' }} aria-label={t('notif.title')} onClick={toggle}>
        <IconBell />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <>
          {/* click-away layer */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
          <div
            className="rise"
            style={{
              position: 'fixed', top: pos.top, right: pos.right, width: pos.width, maxHeight: 'min(70vh, 460px)',
              overflowY: 'auto', padding: 12, zIndex: 1001,
              background: 'var(--popover-bg)', border: '1px solid var(--glass-hairline)', borderRadius: 18, boxShadow: 'var(--shadow-lg)',
            }}
          >
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
                    style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 12, cursor: n.readAt ? 'default' : 'pointer', display: 'flex', gap: 10, background: n.readAt ? 'transparent' : 'var(--popover-hover)', border: n.readAt ? '1px solid var(--glass-hairline)' : '1px solid var(--brand-2)', color: 'var(--text-0)' }}>
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
            <button
              onClick={() => { setOpen(false); setShowChannels(true); }}
              className="glass hairline"
              style={{ width: '100%', marginTop: 10, padding: '9px 12px', borderRadius: 12, fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', cursor: 'pointer' }}
            >
              ⚙️ {t('notif.settings')}
            </button>
          </div>
        </>,
        document.body,
      )}

      {showChannels && typeof document !== 'undefined' && createPortal(
        <NotificationChannelsModal onClose={() => setShowChannels(false)} />,
        document.body,
      )}
    </>
  );
}
