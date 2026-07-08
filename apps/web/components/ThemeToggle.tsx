'use client';

import { useEffect, useState } from 'react';
import { IconMoon, IconSun } from './icons';

type Theme = 'light' | 'dark';

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = (localStorage.getItem('theme') as Theme | null) ?? null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial: Theme = stored ?? (prefersDark ? 'dark' : 'light');
    setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

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
