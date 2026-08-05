'use client';

import { useEffect, useState } from 'react';
import { apiFetch, type MeResponse } from '@/lib/api';
import { currentPushSubscription, disablePush, enablePush, pushSupported } from '@/lib/push';
import { useI18n } from '@/lib/i18n';

export default function NotificationChannelsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushConfigured, setPushConfigured] = useState(true);

  const [lineUserId, setLineUserId] = useState('');
  const [lineSaving, setLineSaving] = useState(false);
  const [lineSaved, setLineSaved] = useState(false);

  useEffect(() => {
    currentPushSubscription().then((sub) => setPushEnabled(!!sub)).catch(() => {});
    apiFetch<{ publicKey: string | null; configured: boolean }>('/notifications/push/vapid-public-key')
      .then((d) => setPushConfigured(d.configured)).catch(() => {});
    apiFetch<MeResponse>('/users/me').then((me) => setLineUserId(me.lineUserId ?? '')).catch(() => {});
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await disablePush();
        setPushEnabled(false);
      } else {
        const res = await enablePush();
        if (res.ok) setPushEnabled(true);
        else setPushError(res.reason ?? 'error');
      }
    } finally { setPushBusy(false); }
  }

  async function saveLine() {
    setLineSaving(true);
    setLineSaved(false);
    try {
      await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ lineUserId }) });
      setLineSaved(true);
    } finally { setLineSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(6,10,20,0.5)', backdropFilter: 'blur(3px)', zIndex: 1200, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: 'min(440px, 100%)', maxHeight: '86vh', overflowY: 'auto', background: 'var(--popover-bg)', border: '1px solid var(--glass-hairline)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{t('notif.channels.title')}</h2>
          <button onClick={onClose} className="glass hairline icon-btn" aria-label={t('common.close')} style={{ width: 32, height: 32, fontSize: 17 }}>×</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 4 }}>🔔 {t('notif.channels.push')}</div>
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>{t('notif.channels.pushHint')}</p>
          {!pushSupported() ? (
            <div className="chip chip-warning">{t('notif.channels.pushUnsupported')}</div>
          ) : !pushConfigured ? (
            <div className="chip chip-warning">{t('notif.channels.pushNotConfigured')}</div>
          ) : (
            <button onClick={togglePush} disabled={pushBusy} className={pushEnabled ? 'btn-danger' : 'btn-primary'} style={{ padding: '9px 16px', fontSize: 13.5, color: pushEnabled ? undefined : '#fff' }}>
              {pushBusy ? t('notif.channels.saving') : pushEnabled ? t('notif.channels.pushDisable') : t('notif.channels.pushEnable')}
            </button>
          )}
          {pushError && <div className="chip chip-danger" style={{ marginTop: 8 }}>{pushError}</div>}
        </div>

        <div>
          <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 4 }}>💬 {t('notif.channels.line')}</div>
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>{t('notif.channels.lineHint')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={lineUserId} onChange={(e) => { setLineUserId(e.target.value); setLineSaved(false); }} placeholder={t('notif.channels.linePlaceholder')} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />
            <button onClick={saveLine} disabled={lineSaving} className="btn-primary" style={{ padding: '9px 18px', fontSize: 13.5, whiteSpace: 'nowrap' }}>
              {lineSaving ? t('notif.channels.saving') : lineSaved ? `✓ ${t('notif.channels.saved')}` : t('notif.channels.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
