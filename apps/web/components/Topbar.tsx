'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './LanguageToggle';
import NotificationBell from './NotificationBell';
import ChangePasswordModal from './ChangePasswordModal';
import { IconSearch, IconLogout, IconMenu } from './icons';
import { clearSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useUI } from '@/lib/ui';

export default function Topbar({ email }: { email: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const { setSidebarOpen } = useUI();
  const [showPwd, setShowPwd] = useState(false);
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <header
      className="glass"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', marginBottom: 20, position: 'relative', zIndex: 50 }}
    >
      <button
        className="glass hairline icon-btn menu-btn"
        style={{ width: 40, height: 40, flexShrink: 0, color: 'var(--text-1)' }}
        aria-label="Menu"
        onClick={() => setSidebarOpen(true)}
      >
        <IconMenu />
      </button>

      <div
        className="glass hairline hide-mobile"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 14, flex: '1 1 180px', minWidth: 0, maxWidth: 420, color: 'var(--text-2)' }}
      >
        <IconSearch style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('top.search')}</span>
      </div>

      <div style={{ flex: 1 }} />

      <LanguageToggle />

      <NotificationBell />

      <ThemeToggle />

      <button
        onClick={() => setShowPwd(true)}
        title={t('pwd.title')}
        style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 6, background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <div className="brand-gradient" style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 13.5 }}>
          {initials}
        </div>
        <div className="hide-mobile" style={{ lineHeight: 1.2, textAlign: 'left' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-0)' }}>{email}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>{t('top.role')}</div>
        </div>
      </button>

      <button
        onClick={() => { clearSession(); router.push('/login'); }}
        className="glass hairline icon-btn"
        style={{ width: 40, height: 40 }}
        aria-label={t('top.logout')}
      >
        <IconLogout />
      </button>

      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </header>
  );
}
