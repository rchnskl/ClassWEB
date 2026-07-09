'use client';

import { useI18n, type Lang } from '@/lib/i18n';

export default function LanguageToggle() {
  const { lang, setLang } = useI18n();
  const opt = (value: Lang, label: string) => (
    <button
      key={value}
      onClick={() => setLang(value)}
      aria-pressed={lang === value}
      style={{
        border: 'none',
        cursor: 'pointer',
        padding: '5px 11px',
        borderRadius: 10,
        fontSize: 12.5,
        fontWeight: 700,
        color: lang === value ? '#fff' : 'var(--text-1)',
        background: lang === value ? 'linear-gradient(120deg, var(--brand-2), var(--brand))' : 'transparent',
        transition: 'all 0.18s ease',
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="glass hairline" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 12, height: 40, alignItems: 'center' }}>
      {opt('th', 'ไทย')}
      {opt('en', 'EN')}
    </div>
  );
}
