'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { IconMoon, IconSun } from './icons';
import { useLocalStorage, writeLocalStorage } from '@/lib/local-store';

type Theme = 'light' | 'dark';

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  writeLocalStorage('theme', theme);
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeToScheme(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export default function ThemeToggle() {
  const stored = useLocalStorage('theme');
  const prefersDark = useSyncExternalStore(subscribeToScheme, () => window.matchMedia(DARK_QUERY).matches, () => false);
  // An explicit choice wins; otherwise follow the OS setting.
  const theme: Theme = stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggle = () => applyTheme(theme === 'dark' ? 'light' : 'dark');

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="glass hairline"
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--text-1)',
        cursor: 'pointer',
      }}
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );
}
