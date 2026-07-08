'use client';

import { useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import { IconSearch, IconBell, IconLogout } from './icons';
import { clearSession } from '@/lib/api';

export default function Topbar({ email }: { email: string }) {
  const router = useRouter();
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <header
      className="glass"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', marginBottom: 20 }}
    >
      <div
        className="glass hairline"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 14, flex: 1, maxWidth: 420, color: 'var(--text-2)' }}
      >
        <IconSearch />
        <span style={{ fontSize: 14 }}>Search students, sections, rooms…</span>
      </div>

      <div style={{ flex: 1 }} />

      <button className="glass hairline" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', color: 'var(--text-1)', cursor: 'pointer', position: 'relative' }} aria-label="Notifications">
        <IconBell />
        <span style={{ position: 'absolute', top: 9, right: 10, width: 7, height: 7, borderRadius: 999, background: 'var(--danger)' }} />
      </button>

      <ThemeToggle />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 6 }}>
        <div className="brand-gradient" style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 13.5 }}>
          {initials}
        </div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{email}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>Administrator</div>
        </div>
      </div>

      <button
        onClick={() => { clearSession(); router.push('/login'); }}
        className="glass hairline"
        style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', color: 'var(--text-1)', cursor: 'pointer' }}
        aria-label="Log out"
      >
        <IconLogout />
      </button>
    </header>
  );
}
