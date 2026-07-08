'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import { apiFetch, saveSession, ApiError, type LoginResponse } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@nursing.au.edu');
  const [password, setPassword] = useState('ChangeMe!2026');
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
      router.push('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Cannot reach the API. Is the backend running on port 3001?',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ position: 'fixed', top: 20, right: 20 }}>
        <ThemeToggle />
      </div>

      <div className="glass glass-strong rise" style={{ width: '100%', maxWidth: 420, padding: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
          <Logo size={48} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>
              Class<span className="brand-text">Web</span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              Faculty of Nursing · Assumption University
            </div>
          </div>
        </div>

        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: -0.4 }}>
          Welcome back
        </h1>
        <p className="muted" style={{ margin: '0 0 24px', fontSize: 14.5 }}>
          Sign in to the classroom platform.
        </p>

        <form onSubmit={onSubmit}>
          <label className="subtle" style={{ fontSize: 13, fontWeight: 600 }}>Email</label>
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

          <label className="subtle" style={{ fontSize: 13, fontWeight: 600 }}>Password</label>
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 22, marginBottom: 0 }}>
          Protected by JWT · RBAC · audited access
        </p>
      </div>
    </main>
  );
}
