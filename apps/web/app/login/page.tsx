'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageToggle from '@/components/LanguageToggle';
import { apiFetch, saveSession, takeRestoreRoute, ApiError, type LoginResponse } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      saveSession(res);
      // Restore the route the user was on when an absolute-timeout logout occurred.
      const restore = takeRestoreRoute();
      router.push(restore && restore.startsWith('/') && !restore.startsWith('/login') ? restore : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('login.apiError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ position: 'fixed', top: 20, right: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className="glass glass-strong rise" style={{ width: '100%', maxWidth: 420, padding: 36 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <Logo size={57} variant="faculty" float />
            <Logo size={60} variant="university" float />
          </div>
          <div style={{ fontSize: 22, fontWeight: 750, letterSpacing: -0.4 }}>
            Class<span className="brand-text">Web</span>
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{t('brand.tagline')}</div>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: -0.4, textAlign: 'center' }}>
          {t('login.welcome')}
        </h1>
        <p className="muted" style={{ margin: '0 0 24px', fontSize: 14.5, textAlign: 'center' }}>
          {t('login.subtitle')}
        </p>

        <form onSubmit={onSubmit}>
          <label className="subtle" style={{ fontSize: 13, fontWeight: 600 }}>{t('login.email')}</label>
          <input
            className="input"
            style={{ margin: '6px 0 16px' }}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@nursing.au.edu"
            autoComplete="username"
            required
          />

          <label className="subtle" style={{ fontSize: 13, fontWeight: 600 }}>{t('login.password')}</label>
          <input
            className="input"
            style={{ margin: '6px 0 8px' }}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />

          {error && (
            <div
              className="chip chip-danger"
              style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 12, padding: '10px 12px', margin: '10px 0 0' }}
            >
              {error}
            </div>
          )}

          <button className="btn-primary" type="submit" disabled={loading} style={{ width: '100%', padding: '13px', fontSize: 15.5, marginTop: 20 }}>
            {loading ? t('login.signingIn') : t('login.signin')}
          </button>
        </form>

        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 22, marginBottom: 0 }}>
          {t('login.footer')}
        </p>
      </div>
    </main>
  );
}
