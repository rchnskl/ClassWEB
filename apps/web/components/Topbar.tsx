'use client';

import { useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './LanguageToggle';
import NotificationBell from './NotificationBell';
import { IconSearch, IconLogout } from './icons';
import { clearSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function Topbar({ email }: { email: string }) {
  const router = useRouter();
  const { t } = useI18n();
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
        <span style={{ fontSize: 14 }}>{t('top.search')}</span>
      </div>

      <div style={{ flex: 1 }} />

      <LanguageToggle />

      <NotificationBell />

      <ThemeToggle />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 6 }}>
        <div className="brand-gradient" style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 13.5 }}>
          {initials}
        </div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{email}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>{t('top.role')}</div>
        </div>
      </div>

      <button
        onClick={() => { clearSession(); router.push('/login'); }}
        className="glass hairline icon-btn"
        style={{ width: 40, height: 40 }}
        aria-label={t('top.logout')}
      >
        <IconLogout />
      </button>
    </header>
  );
}
