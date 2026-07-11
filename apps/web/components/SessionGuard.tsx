'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch, clearSession, getSessionStartAt, saveRestoreState, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const IDLE_MS = 60 * 60 * 1000; // 1 hour with no interaction → lock
const ABSOLUTE_MS = 3 * 60 * 60 * 1000; // 3 hours since login → force logout regardless of activity
const MAX_ATTEMPTS = 5; // failed unlock attempts before forced logout
const CHECK_MS = 15 * 1000; // how often we re-evaluate the deadlines (robust to sleep/clock jumps)

/** Test-only escape hatch: shorten the deadlines via localStorage so QA can exercise the flow
 *  in seconds instead of hours. Never set by the app itself — production leaves it undefined. */
function override(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

export default function SessionGuard({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  // Re-evaluated on every route change: the login page has no session, so the guard idles there.
  const [hasSession, setHasSession] = useState(false);
  const [locked, setLocked] = useState(false);
  const lastActivity = useRef(Date.now());
  const lockedRef = useRef(false);

  useEffect(() => { lockedRef.current = locked; }, [locked]);

  useEffect(() => {
    setHasSession(typeof window !== 'undefined' && !!localStorage.getItem('accessToken'));
  }, [pathname]);

  const forceLogout = useCallback(() => {
    saveRestoreState(pathname + window.location.search);
    clearSession();
    setLocked(false);
    router.replace('/login');
  }, [pathname, router]);

  // Idle-reset on any interaction (ignored while locked so activity behind the modal can't unlock it).
  useEffect(() => {
    if (!hasSession) return;
    const onActivity = () => { if (!lockedRef.current) lastActivity.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
  }, [hasSession]);

  // A single interval drives both deadlines. Interval (not setTimeout) so a slept/woken
  // laptop or a jumped clock is caught on the next tick rather than firing late.
  useEffect(() => {
    if (!hasSession) return;
    const idleMs = override('__sessionIdleMs', IDLE_MS);
    const absoluteMs = override('__sessionAbsoluteMs', ABSOLUTE_MS);
    const checkMs = override('__sessionCheckMs', CHECK_MS);
    const tick = () => {
      const startedAt = getSessionStartAt();
      if (startedAt && Date.now() - startedAt >= absoluteMs) {
        forceLogout();
        return;
      }
      if (!lockedRef.current && Date.now() - lastActivity.current >= idleMs) {
        setLocked(true);
      }
    };
    tick();
    const id = window.setInterval(tick, checkMs);
    return () => window.clearInterval(id);
  }, [hasSession, forceLogout]);

  if (!hasSession) return <>{children}</>;

  return (
    <>
      <div style={locked ? { filter: 'blur(8px)', pointerEvents: 'none', userSelect: 'none' } : undefined} aria-hidden={locked}>
        {children}
      </div>
      {locked && <LockModal onUnlock={() => { setLocked(false); lastActivity.current = Date.now(); }} onForceLogout={forceLogout} />}
    </>
  );

  function LockModal({ onUnlock, onForceLogout }: { onUnlock: () => void; onForceLogout: () => void }) {
    const [password, setPassword] = useState('');
    const [attempts, setAttempts] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    async function submit(e: React.FormEvent) {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await apiFetch('/auth/verify-password', { method: 'POST', body: JSON.stringify({ password }) });
        onUnlock();
      } catch (err) {
        // A hard 401 on the session itself (refresh also dead) → can't continue: log out.
        if (err instanceof ApiError && err.status === 401 && !localStorage.getItem('refreshToken')) {
          onForceLogout();
          return;
        }
        const next = attempts + 1;
        setAttempts(next);
        setPassword('');
        if (next >= MAX_ATTEMPTS) { onForceLogout(); return; }
        setError(t('lock.wrong').replace('{n}', String(MAX_ATTEMPTS - next)));
        inputRef.current?.focus();
      } finally {
        setBusy(false);
      }
    }

    const email = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}').email as string; } catch { return ''; } })();

    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'grid', placeItems: 'center', background: 'rgba(6,10,20,0.55)', backdropFilter: 'blur(2px)', padding: 20 }}>
        <form onSubmit={submit} className="glass glass-strong rise" style={{ width: '100%', maxWidth: 400, padding: 30 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ textAlign: 'center', marginBottom: 6, fontSize: 30 }}>🔒</div>
          <h2 style={{ fontSize: 19, fontWeight: 750, textAlign: 'center', margin: '0 0 4px' }}>{t('lock.title')}</h2>
          <p className="muted" style={{ fontSize: 13.5, textAlign: 'center', margin: '0 0 18px' }}>{t('lock.subtitle')}</p>
          {email && <div className="chip" style={{ display: 'block', textAlign: 'center', marginBottom: 12, background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>{email}</div>}
          <input
            ref={inputRef}
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('lock.password')}
            autoComplete="current-password"
            required
            style={{ marginBottom: 12 }}
          />
          {error && <div className="chip chip-danger" style={{ display: 'block', borderRadius: 12, padding: '9px 12px', marginBottom: 12 }}>{error}</div>}
          <button className="btn-primary" type="submit" disabled={busy || !password} style={{ width: '100%', padding: 12, fontSize: 14.5 }}>
            {busy ? t('lock.verifying') : t('lock.unlock')}
          </button>
          <button type="button" onClick={onForceLogout} className="glass hairline" style={{ width: '100%', padding: 10, fontSize: 13, fontWeight: 600, marginTop: 10, borderRadius: 12, color: 'var(--text-1)' }}>
            {t('lock.logout')}
          </button>
        </form>
      </div>
    );
  }
}
