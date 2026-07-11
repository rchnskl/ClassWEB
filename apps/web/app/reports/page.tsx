'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import PdfPreviewModal from '@/components/PdfPreviewModal';
import { apiFetch, downloadFile, fetchPreviewUrl } from '@/lib/api';
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
  const [exporting, setExporting] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function exportAs(fmt: 'pdf' | 'xlsx' | 'csv') {
    setExporting(fmt);
    try {
      await downloadFile(`/reports/attendance.${fmt}`, `attendance.${fmt}`);
    } catch { /* ignore */ } finally {
      setExporting(null);
    }
  }

  async function previewPdf() {
    setPreviewing(true);
    try {
      setPreviewUrl(await fetchPreviewUrl('/reports/attendance.pdf'));
    } catch { /* ignore */ } finally {
      setPreviewing(false);
    }
  }

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
    <div className="app-shell">
      <Sidebar active="Reports" />
      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('rep.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('rep.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{t('rep.export')}:</span>
            <ExportBtn label={`👁 ${t('common.previewPdf')}`} busy={previewing} onClick={previewPdf} />
            <ExportBtn label={`📄 ${t('rep.exportPdf')}`} busy={exporting === 'pdf'} onClick={() => exportAs('pdf')} primary />
            <ExportBtn label={`📊 ${t('rep.exportExcel')}`} busy={exporting === 'xlsx'} onClick={() => exportAs('xlsx')} />
            <ExportBtn label={`📁 ${t('rep.exportCsv')}`} busy={exporting === 'csv'} onClick={() => exportAs('csv')} />
          </div>
        </div>

        {loading ? (
          <div className="glass rise" style={{ padding: 40, textAlign: 'center' }} ><span className="muted">{t('common.loading')}</span></div>
        ) : !data || data.totals.records === 0 ? (
          <div className="glass rise" style={{ padding: 40, textAlign: 'center' }}><span className="muted">{t('rep.noData')}</span></div>
        ) : (
          <>
            {/* Top: overall rate + breakdown + risk tiers */}
            <div className="grid-sidebar" style={{ marginBottom: 16 }}>
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

            <div className="grid-2">
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

      {previewUrl && <PdfPreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}

function ExportBtn({ label, busy, onClick, primary }: { label: string; busy: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick} disabled={busy}
      className={primary ? 'btn-primary' : 'glass hairline'}
      style={{ padding: '9px 14px', borderRadius: 12, fontSize: 13.5, fontWeight: 650, cursor: busy ? 'wait' : 'pointer', color: primary ? '#fff' : 'var(--text-1)' }}
    >
      {busy ? '…' : label}
    </button>
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
