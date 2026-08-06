'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './LanguageToggle';
import NotificationBell from './NotificationBell';
import ChangePasswordModal from './ChangePasswordModal';
import GlobalSearch from './GlobalSearch';
import { IconLogout, IconMenu } from './icons';
import { apiFetch, clearSession, type MeResponse } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useUI } from '@/lib/ui';

// Highest-privilege role wins when a user holds more than one (an admin
// who is also a lecturer is still shown as Administrator).
const ROLE_RANK = ['ADMIN', 'LECTURER', 'STUDENT'];

export default function Topbar({ email }: { email: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const { setSidebarOpen } = useUI();
  const [showPwd, setShowPwd] = useState(false);
  const [roleCode, setRoleCode] = useState<string | null>(null);
  const initials = email.slice(0, 2).toUpperCase();

  useEffect(() => {
    // Previously a hardcoded "Administrator" label shown to every user
    // regardless of their actual role — a lecturer's own topbar claimed
    // they were an admin. Resolve the real role once per mount instead.
    apiFetch<MeResponse>('/users/me')
      .then((me) => {
        const codes = me.roles.map((r) => r.role.code);
        const top = ROLE_RANK.find((r) => codes.includes(r)) ?? codes[0] ?? null;
        setRoleCode(top);
      })
      .catch(() => {});
  }, []);

  const roleLabel = roleCode ? t(`role.${roleCode}`) : '';

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

      <GlobalSearch />

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
          <div className="muted" style={{ fontSize: 11.5 }}>{roleLabel}</div>
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
