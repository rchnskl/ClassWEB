'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface StudentRow {
  studentId: string; studentCode: string; nameEn: string; nameTh: string | null; program: string;
  total: number; present: number; late: number; absent: number; rate: number;
  tier: 'OK' | 'WARNING' | 'RISK' | 'CRITICAL'; badges: string[];
}
interface Overview {
  totals: { records: number; present: number; late: number; absent: number };
  overallRate: number | null;
  studentsTracked: number;
  risk: { below80: number; below70: number; below60: number };
  atRisk: StudentRow[];
  top: StudentRow[];
}

const TIER_COLOR: Record<string, string> = {
  OK: 'var(--success)', WARNING: 'var(--warning)', RISK: '#f4772e', CRITICAL: 'var(--danger)',
};

export default function ReportsPage() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('admin@nursing.au.edu');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
    apiFetch<Overview>('/analytics/overview').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [router]);

  const name = (s: StudentRow) => (lang === 'th' && s.nameTh ? s.nameTh : s.nameEn);
  const tot = data?.totals;
  const denom = tot ? Math.max(1, tot.records) : 1;

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, maxWidth: 1440, margin: '0 auto' }}>
      <Sidebar active="Reports" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Topbar email={email} />

        <div className="rise" style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('rep.title')}</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('rep.subtitle')}</p>
        </div>

        {loading ? (
          <div className="glass rise" style={{ padding: 40, textAlign: 'center' }} ><span className="muted">{t('common.loading')}</span></div>
        ) : !data || data.totals.records === 0 ? (
          <div className="glass rise" style={{ padding: 40, textAlign: 'center' }}><span className="muted">{t('rep.noData')}</span></div>
        ) : (
          <>
            {/* Top: overall rate + breakdown + risk tiers */}
            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, marginBottom: 16 }}>
              <div className="glass rise" style={{ padding: 22, textAlign: 'center' }}>
                <div className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{t('rep.overallRate')}</div>
                <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: -1.5, margin: '6px 0', color: 'var(--brand)' }}>{data.overallRate ?? '—'}%</div>
                <div className="muted" style={{ fontSize: 12 }}>{data.totals.records} {t('rep.records')} · {data.studentsTracked} {t('rep.studentsTracked')}</div>

                {/* stacked breakdown bar */}
                <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', marginTop: 16 }}>
                  <div style={{ width: `${(tot!.present / denom) * 100}%`, background: 'var(--success)' }} />
                  <div style={{ width: `${(tot!.late / denom) * 100}%`, background: 'var(--warning)' }} />
                  <div style={{ width: `${(tot!.absent / denom) * 100}%`, background: 'var(--danger)' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5 }}>
                  <span style={{ color: 'var(--success)' }}>● {t('rep.present')} {tot!.present}</span>
                  <span style={{ color: 'var(--warning)' }}>● {t('rep.late')} {tot!.late}</span>
                  <span style={{ color: 'var(--danger)' }}>● {t('rep.absent')} {tot!.absent}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                <RiskCard label={t('rep.below80')} value={data.risk.below80} color="var(--warning)" />
                <RiskCard label={t('rep.below70')} value={data.risk.below70} color="#f4772e" />
                <RiskCard label={t('rep.below60')} value={data.risk.below60} color="var(--danger)" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
              {/* At-risk list */}
              <div className="glass rise" style={{ padding: 20 }}>
                <h2 style={{ fontSize: 16.5, fontWeight: 700, margin: '0 0 14px' }}>⚠️ {t('rep.atRisk')}</h2>
                {data.atRisk.length === 0 ? (
                  <div className="muted" style={{ textAlign: 'center', padding: 20 }}>{t('rep.noRisk')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {data.atRisk.map((s) => (
                      <div key={s.studentId} className="glass hairline" style={{ padding: 14, borderRadius: 14, borderLeft: `3px solid ${TIER_COLOR[s.tier]}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: 12.5 }}>{s.studentCode}</span>
                          <span style={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 100 }}>{name(s)}</span>
                          <span className="chip" style={{ background: `${TIER_COLOR[s.tier]}22`, color: TIER_COLOR[s.tier] }}>{t(`tier.${s.tier}`)}</span>
                          <span style={{ fontWeight: 750, fontSize: 16, color: TIER_COLOR[s.tier] }}>{s.rate}%</span>
                        </div>
                        <div style={{ height: 7, borderRadius: 999, background: 'var(--glass-hairline)', marginTop: 10, overflow: 'hidden' }}>
                          <div style={{ width: `${s.rate}%`, height: '100%', background: TIER_COLOR[s.tier] }} />
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                          <span className="muted" style={{ fontSize: 11 }}>{t('rep.present')} {s.present} · {t('rep.late')} {s.late} · {t('rep.absent')} {s.absent}</span>
                          {s.badges.filter((b) => b === 'CHRONIC_ABSENCE' || b === 'REPEATED_LATE').map((b) => (
                            <span key={b} className="chip chip-danger" style={{ fontSize: 10 }}>{t(`badge.${b}`)}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Top attendance */}
              <div className="glass rise" style={{ padding: 20 }}>
                <h2 style={{ fontSize: 16.5, fontWeight: 700, margin: '0 0 14px' }}>🏆 {t('rep.top')}</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.top.map((s, i) => (
                    <div key={s.studentId} className="glass hairline" style={{ padding: '10px 14px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 800, color: 'var(--brand)', width: 20 }}>{i + 1}</span>
                      <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(s)}</span>
                      <span style={{ fontWeight: 750, color: s.rate >= 80 ? 'var(--success)' : TIER_COLOR[s.tier] }}>{s.rate}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RiskCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="glass rise" style={{ padding: 20 }}>
      <div className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1, marginTop: 8, color }}>{value}</div>
    </div>
  );
}
