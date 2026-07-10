'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) { setError(t('pwd.tooShort')); return; }
    if (newPassword !== confirmPassword) { setError(t('pwd.mismatch')); return; }
    setSaving(true);
    try {
      await apiFetch('/auth/change-password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(6,10,20,0.5)', backdropFilter: 'blur(3px)', zIndex: 1200, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: 'min(400px, 100%)', background: 'var(--popover-bg)', border: '1px solid var(--glass-hairline)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{t('pwd.title')}</h2>
          <button onClick={onClose} className="glass hairline icon-btn" style={{ width: 32, height: 32, fontSize: 17 }}>×</button>
        </div>

        {done ? (
          <div>
            <div className="chip chip-success" style={{ display: 'block', marginBottom: 14 }}>{t('pwd.success')}</div>
            <button onClick={onClose} className="btn-primary" style={{ width: '100%', padding: 12, fontSize: 14.5 }}>{t('pwd.close')}</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <Field label={t('pwd.current')}>
              <input className="input" type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </Field>
            <Field label={t('pwd.new')}>
              <input className="input" type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Field>
            <Field label={t('pwd.confirm')}>
              <input className="input" type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </Field>
            {error && <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
            <button type="submit" disabled={saving} className="btn-primary" style={{ width: '100%', padding: 12, fontSize: 14.5, marginTop: 4 }}>
              {saving ? t('pwd.saving') : t('pwd.save')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span className="subtle" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
