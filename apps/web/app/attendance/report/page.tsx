'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { apiFetch, downloadFile } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useStoredUser } from '@/lib/local-store';

interface SectionRef { id: string; sectionNo: string; subject: { id: string; code: string; nameEn: string } }
type Mark = 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'EXCUSED' | null;
interface Day {
  sessionId: string; date: string; startTime: string; endTime: string; topic: string | null; upcoming: boolean;
  enrolled: number; present: number; late: number; absent: number; leave: number; unrecorded: number; rate: number | null;
}
interface StudentRow { studentId: string; studentCode: string; nameEn: string; nameTh: string | null; marks: Mark[]; attended: number; absent: number; late: number; rate: number | null }
interface Report {
  section: { sectionNo: string; subject: { code: string; nameEn: string; nameTh: string | null }; lecturer: { nameEn: string } | null; room: { roomNumber: string } | null };
  days: Day[]; students: StudentRow[];
  totals: { classDays: number; daysHeld: number; averageRate: number | null; studentsBelow80: number };
}

const MARK: Record<string, { sym: string; color: string }> = {
  PRESENT: { sym: '/', color: 'var(--success)' },
  LATE: { sym: 'ส', color: 'var(--warning)' },
  ABSENT: { sym: 'ข', color: 'var(--danger)' },
  LEAVE: { sym: 'ล', color: 'var(--brand-blue)' },
  EXCUSED: { sym: 'ล', color: 'var(--brand-blue)' },
};
const rateColor = (r: number | null) => (r == null ? 'var(--text-2)' : r >= 80 ? 'var(--success)' : r >= 70 ? 'var(--warning)' : 'var(--danger)');
const th: React.CSSProperties = { padding: '8px 10px', fontSize: 12, fontWeight: 700, textAlign: 'left', color: 'var(--text-1)', borderBottom: '1px solid var(--glass-hairline)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 13, borderBottom: '1px solid var(--glass-hairline)', whiteSpace: 'nowrap' };

/**
 * Attendance overview of a section across its class days: per-day counts
 * and rate, and a student × day grid with each student's attendance rate.
 */
export default function AttendanceReportPage() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const email = useStoredUser()?.email ?? '';
  const [sections, setSections] = useState<SectionRef[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fmtDay = (iso: string, long = false) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB',
    long ? { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const sname = (s: { nameEn: string; nameTh: string | null }) => (lang === 'th' && s.nameTh ? s.nameTh : s.nameEn);

  const load = useCallback(async (id: string) => {
    setLoading(true); setError(null);
    try { setReport(await apiFetch<Report>(`/attendance/sections/${id}/daily`)); }
    catch (err) { setReport(null); setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    apiFetch<{ items: SectionRef[] }>('/sections').then((d) => {
      setSections(d.items);
      let last: string | null = null;
      try { last = localStorage.getItem('attendanceReport.section'); } catch { /* ignore */ }
      const first = d.items.find((x) => x.id === last) ?? d.items[0];
      if (first) { setSectionId(first.id); void load(first.id); } else setLoading(false);
    }).catch(() => setLoading(false));
  }, [router, load]);

  function pick(id: string) {
    setSectionId(id); void load(id);
    try { localStorage.setItem('attendanceReport.section', id); } catch { /* ignore */ }
  }

  async function exportXlsx() {
    if (!sectionId) return;
    setExporting(true);
    try { await downloadFile(`/attendance/sections/${sectionId}/daily.xlsx`, 'attendance.xlsx'); } finally { setExporting(false); }
  }

  const held = report?.days.filter((d) => !d.upcoming || d.enrolled - d.unrecorded > 0) ?? [];

  return (
    <div className="app-shell">
      <Sidebar active="Attendance" />
      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('attr.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('attr.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/attendance" className="glass hairline" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13.5, color: 'var(--text-0)', textDecoration: 'none' }}>← {t('attr.back')}</Link>
            <button className="btn-primary" onClick={exportXlsx} disabled={!report || exporting} style={{ padding: '9px 14px', fontSize: 13.5 }}>📊 {exporting ? '…' : t('attr.excel')}</button>
          </div>
        </div>

        {/* One button per subject/section: each subject's report is separate. */}
        <div className="glass rise" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }} role="tablist" aria-label={t('case.section')}>
          {sections.map((s) => {
            const on = s.id === sectionId;
            return (
              <button key={s.id} role="tab" aria-selected={on} onClick={() => pick(s.id)}
                style={{ padding: '8px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', color: on ? '#fff' : 'var(--text-0)',
                  border: on ? '1px solid var(--brand)' : '1px solid var(--glass-hairline)', background: on ? 'var(--brand)' : 'transparent' }}>
                <div style={{ fontWeight: 750, fontSize: 14 }}>{s.subject.code} · {t('case.group')} {s.sectionNo}</div>
                <div style={{ fontSize: 11.5, opacity: 0.85 }}>{s.subject.nameEn}</div>
              </button>
            );
          })}
        </div>
        {report && (
          <h2 style={{ fontSize: 19, fontWeight: 750, margin: '0 0 12px' }}>
            {report.section.subject.code} {lang === 'th' && report.section.subject.nameTh ? report.section.subject.nameTh : report.section.subject.nameEn}
            <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}> · {t('case.group')} {report.section.sectionNo}{report.section.lecturer ? ` · ${report.section.lecturer.nameEn}` : ''}{report.section.room ? ` · ${report.section.room.roomNumber}` : ''}</span>
          </h2>
        )}

        {error && <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
        {loading && <div className="muted" style={{ padding: 20 }}>{t('common.loading')}</div>}

        {report && !loading && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                { label: t('attr.avg'), value: report.totals.averageRate != null ? `${report.totals.averageRate}%` : '—', color: rateColor(report.totals.averageRate) },
                { label: t('attr.daysHeld'), value: `${report.totals.daysHeld} / ${report.totals.classDays}`, color: 'var(--text-0)' },
                { label: t('attr.students'), value: String(report.students.length), color: 'var(--text-0)' },
                { label: t('attr.below80'), value: String(report.totals.studentsBelow80), color: report.totals.studentsBelow80 > 0 ? 'var(--danger)' : 'var(--success)' },
              ].map((c) => (
                <div key={c.label} className="glass rise" style={{ padding: 14 }}>
                  <div className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 750, color: c.color, marginTop: 4 }}>{c.value}</div>
                </div>
              ))}
            </div>

            <div className="glass rise" style={{ padding: 16, marginBottom: 16, overflowX: 'auto' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>{t('attr.byDay')}</h2>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
                <thead><tr>
                  {[t('attr.date'), t('attr.time'), t('att.present'), t('att.late'), t('att.absent'), t('attr.leave'), t('attr.unrecorded'), t('attr.rate')].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {report.days.map((d) => (
                    <tr key={d.sessionId} style={{ opacity: d.upcoming ? 0.5 : 1 }}>
                      <td style={{ ...td, fontWeight: 600 }}>{fmtDay(d.date, true)}{d.topic ? <span className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}> · {d.topic}</span> : null}</td>
                      <td style={td}>{d.startTime}–{d.endTime}</td>
                      <td style={{ ...td, color: 'var(--success)', fontWeight: 600 }}>{d.upcoming ? '' : d.present}</td>
                      <td style={{ ...td, color: 'var(--warning)', fontWeight: 600 }}>{d.upcoming ? '' : d.late}</td>
                      <td style={{ ...td, color: 'var(--danger)', fontWeight: 600 }}>{d.upcoming ? '' : d.absent}</td>
                      <td style={td}>{d.upcoming ? '' : d.leave}</td>
                      <td className="muted" style={td}>{d.upcoming ? t('attr.upcoming') : d.unrecorded}</td>
                      <td style={{ ...td, fontWeight: 700, color: rateColor(d.rate) }}>
                        {d.rate != null ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--glass-hairline)', display: 'inline-block', overflow: 'hidden' }}>
                              <span style={{ display: 'block', height: '100%', width: `${d.rate}%`, background: rateColor(d.rate) }} />
                            </span>
                            {d.rate}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="glass rise" style={{ padding: 16, overflowX: 'auto' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>{t('attr.byStudent')}</h2>
              <p className="muted" style={{ fontSize: 11.5, margin: '0 0 10px' }}>{t('attr.legend')}</p>
              <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                <thead><tr>
                  <th style={{ ...th, position: 'sticky', left: 0, background: 'var(--popover-bg)', zIndex: 1 }}>{t('attr.student')}</th>
                  {held.map((d) => <th key={d.sessionId} style={{ ...th, textAlign: 'center', fontSize: 11 }}>{fmtDay(d.date)}</th>)}
                  <th style={{ ...th, textAlign: 'right' }}>{t('attr.rate')}</th>
                </tr></thead>
                <tbody>
                  {report.students.map((s) => (
                    <tr key={s.studentId}>
                      <td style={{ ...td, position: 'sticky', left: 0, background: 'var(--popover-bg)', zIndex: 1 }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{s.studentCode}</span> {sname(s)}
                      </td>
                      {held.map((d) => {
                        const m = s.marks[report.days.indexOf(d)];
                        const info = m ? MARK[m] : null;
                        return <td key={d.sessionId} style={{ ...td, textAlign: 'center', fontWeight: 700, color: info?.color ?? 'var(--text-2)' }}>{info?.sym ?? '·'}</td>;
                      })}
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: rateColor(s.rate) }}>{s.rate != null ? `${s.rate}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
