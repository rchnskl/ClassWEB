'use client';

import { use, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageToggle from '@/components/LanguageToggle';
import { apiFetch, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Ctx {
  subject: { code: string; nameEn: string };
  sectionNo: string;
  date: string;
  startTime: string;
  endTime: string;
}
type Result = { result: 'success' | 'pending' | 'unmatched_confirm'; attendanceStatus?: string; message?: string; enteredCode?: string };

export default function CheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t } = useI18n();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [expired, setExpired] = useState(false);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [confirmNeeded, setConfirmNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Ctx>(`/attendance/checkin/${token}`)
      .then(setCtx)
      .catch(() => setExpired(true));
  }, [token]);

  async function send(confirm: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<Result>('/attendance/checkin', {
        method: 'POST',
        body: JSON.stringify({ token, studentCode: code.trim(), confirm }),
      });
      if (res.result === 'unmatched_confirm') {
        // Possible typo — ask the student to verify before committing.
        setConfirmNeeded(true);
      } else {
        setConfirmNeeded(false);
        setResult(res);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setExpired(true);
      else setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void send(false);
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ position: 'fixed', top: 20, right: 20, display: 'flex', gap: 10 }}>
        <LanguageToggle /><ThemeToggle />
      </div>

      <div className="glass glass-strong rise" style={{ width: '100%', maxWidth: 380, padding: 32, textAlign: 'center' }}>
        <Logo size={56} float />
        <h1 style={{ fontSize: 20, fontWeight: 750, margin: '14px 0 2px' }}>{t('ci.title')}</h1>

        {expired ? (
          <p className="chip chip-warning" style={{ margin: '18px auto 0', padding: '10px 14px', borderRadius: 12 }}>{t('ci.expired')}</p>
        ) : !ctx ? (
          <p className="muted" style={{ marginTop: 18 }}>{t('common.loading')}</p>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
              {ctx.subject.code} · {ctx.subject.nameEn}
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
              Sec {ctx.sectionNo} · {ctx.startTime}–{ctx.endTime}
            </div>

            {confirmNeeded && !result ? (
              <div style={{ marginTop: 18 }}>
                <div className="glass hairline" style={{ padding: 18, borderRadius: 16 }}>
                  <div style={{ fontSize: 30, marginBottom: 6 }}>🤔</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{t('ci.confirmQ')}</div>
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 26, fontWeight: 750, letterSpacing: 2, margin: '10px 0', color: 'var(--brand)' }}>{code}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>{t('ci.confirmHint')}</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => setConfirmNeeded(false)} className="glass hairline" style={{ flex: 1, padding: 11, borderRadius: 12, fontWeight: 650, color: 'var(--text-1)', cursor: 'pointer', fontSize: 14 }}>
                      {t('ci.edit')}
                    </button>
                    <button onClick={() => void send(true)} disabled={submitting} className="btn-primary" style={{ flex: 1, padding: 11, fontSize: 14 }}>
                      {submitting ? t('ci.submitting') : t('ci.confirmYes')}
                    </button>
                  </div>
                </div>
              </div>
            ) : result ? (
              <div style={{ marginTop: 20 }}>
                {result.result === 'success' ? (
                  <div className="chip chip-success" style={{ fontSize: 15, padding: '14px 18px', borderRadius: 16, flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 34 }}>✅</div>
                    {result.attendanceStatus === 'LATE' ? t('ci.successLate') : t('ci.success')}
                  </div>
                ) : (
                  <div className="chip chip-warning" style={{ fontSize: 14, padding: '14px 18px', borderRadius: 16, flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 30 }}>⚠️</div>
                    {t('ci.pending')}
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={submit} style={{ marginTop: 18 }}>
                <label className="subtle" style={{ fontSize: 13, fontWeight: 600, display: 'block', textAlign: 'left', marginBottom: 6 }}>{t('ci.enterCode')}</label>
                <input
                  className="input" value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder={t('ci.placeholder')} inputMode="numeric" required autoFocus
                  style={{ textAlign: 'center', fontSize: 18, letterSpacing: 1, fontWeight: 600 }}
                />
                {error && <div className="chip chip-danger" style={{ marginTop: 12, borderRadius: 10, padding: '8px 12px' }}>{error}</div>}
                <button className="btn-primary" type="submit" disabled={submitting || !code.trim()} style={{ width: '100%', padding: 13, fontSize: 15.5, marginTop: 16 }}>
                  {submitting ? t('ci.submitting') : t('ci.submit')}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
