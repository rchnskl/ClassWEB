import type { ReactNode } from 'react';

export default function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: ReactNode;
  tone?: 'brand' | 'blue' | 'danger' | 'warning' | 'success';
  delay?: number;
}) {
  const toneColor =
    tone === 'danger' ? 'var(--danger)'
    : tone === 'warning' ? 'var(--warning)'
    : tone === 'success' ? 'var(--success)'
    : tone === 'blue' ? 'var(--brand-blue)'
    : 'var(--brand)';

  return (
    <div className="glass rise" style={{ padding: 20, animationDelay: `${delay}ms` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <div
          style={{
            width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center',
            color: toneColor, background: 'var(--glass-hairline)',
          }}
        >
          {icon}
        </div>
      </div>
      <div style={{ fontSize: 32, fontWeight: 750, letterSpacing: -1, marginTop: 12, lineHeight: 1 }}>
        {value}
      </div>
      {hint && <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{hint}</div>}
    </div>
  );
}
