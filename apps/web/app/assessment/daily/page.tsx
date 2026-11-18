'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import PdfPreviewModal from '@/components/PdfPreviewModal';
import { apiFetch, downloadFile, fetchPreviewUrl } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useStoredUser } from '@/lib/local-store';

interface SectionRef { id: string; sectionNo: string; subject: { id: string; code: string; nameEn: string } }
interface Named { nameEn: string; nameTh: string | null }
interface Evaluator { key: string; email: string | null; nameEn: string | null; nameTh: string | null }
type Status = 'SCORED' | 'ABSENT' | 'LEAVE' | 'PENDING' | 'UPCOMING';
interface Cell {
  status: Status; scorePercent: number | null; criticalFailed: boolean; note: string | null;
  rawScore: number | null; rawMax: number | null;
  sectionScores: Array<number | null> | null; ratings: Record<string, number> | null; failedCritical: string[];
  evaluator: Evaluator | null; at: string | null; attendance: string | null;
}
/** Provisional grade while scores are still coming in — an estimate, never the final grade. */
export interface Estimate { estimate: number; grade: string | null; gpa: number | null; basisWeight: number; totalWeight: number }
interface StudentRow extends Named {
  studentId: string; studentCode: string; cells: Cell[];
  assessedDays: number; countedDays: number; pendingDays: number; missedDays: number;
  dayAverage: number | null; sectionAverages: Array<number | null>; component: number | null; points: number | null; criticalFailed: boolean;
  estimate: Estimate | null;
}
interface Day {
  sessionId: string; date: string; startTime: string; endTime: string; topic: string | null; upcoming: boolean;
  enrolled: number; assessed: number; absent: number; leave: number; pending: number;
  average: number | null; min: number | null; max: number | null; criticalFails: number;
  sectionAverages: Array<number | null>; evaluators: Array<Evaluator & { count: number }>;
}
interface RubricSection extends Named { id: string; weightPercent: number; items: Array<{ id: string; textEn: string; textTh: string | null; maxRating: number; isCritical: boolean }> }
interface Report {
  section: { sectionNo: string; subject: Named & { code: string }; lecturer: Named | null; room: { roomNumber: string } | null };
  rubrics: Array<Named & { id: string; weightPercent: number }>;
  rubric: (Named & { id: string; weightPercent: number; sections: RubricSection[] }) | null;
  days: Day[]; students: StudentRow[];
  totals: { practiceDays: number; daysAssessed: number; assessments: number; pending: number; average: number | null; threshold: number; studentsBelow: number } | null;
}

const th: React.CSSProperties = { padding: '8px 10px', fontSize: 12, fontWeight: 700, textAlign: 'left', color: 'var(--text-1)', borderBottom: '1px solid var(--glass-hairline)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 13, borderBottom: '1px solid var(--glass-hairline)', whiteSpace: 'nowrap' };
const sticky: React.CSSProperties = { position: 'sticky', left: 0, background: 'var(--popover-bg)', zIndex: 1 };

/**
 * Daily ward-assessment report of a section: the per-session (daily) rubric
 * scores given on each practice day — by day, as a student × day grid, and
 * averaged per rubric category — with who assessed each day.
 */
export default function DailyAssessmentReportPage() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const email = useStoredUser()?.email ?? '';
  const [sections, setSections] = useState<SectionRef[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [rubricId, setRubricId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ studentId: string; dayIdx: number } | null>(null);

  const thr = report?.totals?.threshold ?? 70;
  const scoreColor = (v: number | null) => (v == null ? 'var(--text-2)' : v >= 80 ? 'var(--success)' : v >= thr ? 'var(--warning)' : 'var(--danger)');
  const nm = (x: { nameEn: string | null; nameTh: string | null }) => (lang === 'th' ? x.nameTh ?? x.nameEn : x.nameEn ?? x.nameTh) ?? '';
  const who = (e: Evaluator) => nm(e) || e.email || '—';
  const fmtDay = (iso: string, long = false) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB',
    long ? { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fmtAt = (iso: string) => new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  const q = (rid: string) => (rid ? `rubricId=${encodeURIComponent(rid)}&` : '');

  const load = useCallback(async (id: string, rid: string) => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch<Report>(`/assessment/sections/${id}/daily${rid ? `?rubricId=${encodeURIComponent(rid)}` : ''}`);
      setReport(r); setRubricId(r.rubric?.id ?? '');
    } catch (err) { setReport(null); setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    apiFetch<{ items: SectionRef[] }>('/sections').then((d) => {
      setSections(d.items);
      let last: string | null = null;
      try { last = localStorage.getItem('dailyAssessmentReport.section'); } catch { /* ignore */ }
      const first = d.items.find((x) => x.id === last) ?? d.items[0];
      if (first) { setSectionId(first.id); void load(first.id, ''); } else setLoading(false);
    }).catch(() => setLoading(false));
  }, [router, load]);

  function pick(id: string) {
    setSectionId(id); setPicked(null); void load(id, '');
    try { localStorage.setItem('dailyAssessmentReport.section', id); } catch { /* ignore */ }
  }

  async function exportXlsx() {
    if (!sectionId) return;
    setExporting('xlsx');
    try { await downloadFile(`/assessment/sections/${sectionId}/daily.xlsx?${q(rubricId)}`, 'daily-assessment.xlsx'); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setExporting(null); }
  }
  async function exportPdf() {
    if (!sectionId) return;
    setExporting('pdf');
    try { await downloadFile(`/reports/assessment/section/${sectionId}/daily/pdf?${q(rubricId)}lang=${lang}`, 'daily-assessment.pdf'); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setExporting(null); }
  }
  async function previewPdf() {
    if (!sectionId) return;
    setPreviewing(true);
    try { setPreviewUrl(await fetchPreviewUrl(`/reports/assessment/section/${sectionId}/daily/pdf?${q(rubricId)}lang=${lang}`)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPreviewing(false); }
  }

  const rb = report?.rubric ?? null;
  const totals = report?.totals ?? null;
  const canExport = !!rb && !!report && report.days.length > 0;

  const cellText = (c: Cell) => (c.status === 'SCORED' ? `${Math.round(c.scorePercent! * 10) / 10}${c.criticalFailed ? '!' : ''}`
    : c.status === 'ABSENT' ? 'ข' : c.status === 'LEAVE' ? 'ล' : c.status === 'PENDING' ? '·' : '');
  const cellColor = (c: Cell) => (c.status === 'SCORED' ? scoreColor(c.scorePercent) : c.status === 'ABSENT' ? 'var(--danger)'
    : c.status === 'LEAVE' ? 'var(--brand-blue)' : 'var(--text-2)');

  return (
    <div className="app-shell">
      <Sidebar active="Assessment" />
      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('asd.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('asd.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/assessment" className="glass hairline" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13.5, color: 'var(--text-0)', textDecoration: 'none' }}>← {t('asd.back')}</Link>
            <button className="glass hairline" onClick={previewPdf} disabled={!canExport || previewing} style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13.5, fontWeight: 650, color: 'var(--text-0)', cursor: previewing ? 'wait' : 'pointer', opacity: canExport ? 1 : 0.5 }}>👁 {previewing ? '…' : t('common.previewPdf')}</button>
            <button className="glass hairline" onClick={exportXlsx} disabled={!canExport || exporting != null} style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13.5, fontWeight: 650, color: 'var(--text-0)', cursor: 'pointer', opacity: canExport ? 1 : 0.5 }}>📊 {exporting === 'xlsx' ? '…' : t('asd.excel')}</button>
            <button className="btn-primary" onClick={exportPdf} disabled={!canExport || exporting != null} style={{ padding: '9px 14px', fontSize: 13.5, opacity: canExport ? 1 : 0.5 }}>📄 {exporting === 'pdf' ? '…' : t('asd.pdf')}</button>
          </div>
        </div>

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 12px' }}>
            <h2 style={{ fontSize: 19, fontWeight: 750, margin: 0 }}>
              {report.section.subject.code} {nm(report.section.subject)}
              <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}> · {t('case.group')} {report.section.sectionNo}{report.section.lecturer ? ` · ${nm(report.section.lecturer)}` : ''}{report.section.room ? ` · ${report.section.room.roomNumber}` : ''}</span>
            </h2>
            {report.rubrics.length > 1 ? (
              <select aria-label={t('asd.component')} className="input" value={rubricId} onChange={(e) => { setPicked(null); void load(sectionId, e.target.value); }} style={{ width: 'auto' }}>
                {report.rubrics.map((r) => <option key={r.id} value={r.id}>{nm(r)} ({r.weightPercent}%)</option>)}
              </select>
            ) : rb ? (
              <span className="chip" style={{ fontWeight: 650 }}>{t('asd.component')}: {nm(rb)} · {rb.weightPercent}%</span>
            ) : null}
          </div>
        )}

        {error && <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
        {loading && <div className="muted" style={{ padding: 20 }}>{t('common.loading')}</div>}
        {report && !loading && !rb && <div className="glass" style={{ padding: 20 }}>{t('asd.none')}</div>}
        {report && !loading && rb && report.days.length === 0 && <div className="glass" style={{ padding: 20 }}>{t('asd.noDays')}</div>}

        {report && !loading && rb && totals && report.days.length > 0 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                { label: t('asd.avg'), value: totals.average != null ? `${totals.average}%` : '—', color: scoreColor(totals.average) },
                { label: t('asd.daysAssessed'), value: `${totals.daysAssessed} / ${totals.practiceDays}`, color: 'var(--text-0)' },
                { label: t('asd.assessments'), value: `${totals.assessments} (${totals.pending})`, color: totals.pending > 0 ? 'var(--warning)' : 'var(--text-0)' },
                { label: t('asd.below').replace('{n}', String(totals.threshold)), value: String(totals.studentsBelow), color: totals.studentsBelow > 0 ? 'var(--danger)' : 'var(--success)' },
              ].map((c) => (
                <div key={c.label} className="glass rise" style={{ padding: 14 }}>
                  <div className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 750, color: c.color, marginTop: 4 }}>{c.value}</div>
                </div>
              ))}
            </div>

            <div className="glass rise" style={{ padding: 16, marginBottom: 16, minWidth: 0 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>{t('asd.byDay')}</h2>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
                <thead><tr>
                  {[t('asd.date'), t('asd.time'), t('asd.assessed'), t('asd.absent'), t('asd.leave'), t('asd.pending'), t('asd.average'), t('asd.range'), t('asd.by')].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {report.days.map((d) => {
                    const dim = d.upcoming && d.assessed === 0;
                    return (
                      <tr key={d.sessionId} style={{ opacity: dim ? 0.5 : 1 }}>
                        <td style={{ ...td, fontWeight: 600 }}>{fmtDay(d.date, true)}{d.topic ? <span className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}> · {d.topic}</span> : null}</td>
                        <td style={td}>{d.startTime}–{d.endTime}</td>
                        <td style={{ ...td, fontWeight: 700, color: 'var(--brand)' }}>{d.assessed}/{d.enrolled}</td>
                        <td style={{ ...td, color: 'var(--danger)', fontWeight: 600 }}>{d.absent || ''}</td>
                        <td style={{ ...td, color: 'var(--brand-blue)' }}>{d.leave || ''}</td>
                        <td style={{ ...td, color: d.pending > 0 ? 'var(--warning)' : 'var(--text-2)', fontWeight: d.pending > 0 ? 700 : 400 }}>{dim ? t('asd.upcoming') : d.pending}</td>
                        <td style={{ ...td, fontWeight: 700, color: scoreColor(d.average) }}>
                          {d.average != null ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--glass-hairline)', display: 'inline-block', overflow: 'hidden' }}>
                                <span style={{ display: 'block', height: '100%', width: `${Math.min(100, d.average)}%`, background: scoreColor(d.average) }} />
                              </span>
                              {d.average}%
                            </span>
                          ) : '—'}
                          {d.criticalFails > 0 && <span title={t('asd.critical')} style={{ marginLeft: 6, color: 'var(--danger)' }}>⚠ {d.criticalFails}</span>}
                        </td>
                        <td className="muted" style={td}>{d.min != null ? `${d.min}–${d.max}` : '—'}</td>
                        <td style={{ ...td, whiteSpace: 'normal', minWidth: 160, fontSize: 12 }}>
                          {d.evaluators.length === 0 ? <span className="muted">—</span> : d.evaluators.map((e) => (
                            <span key={e.key} title={e.email ?? undefined} className="chip chip-success" style={{ display: 'inline-block', margin: '1px 4px 1px 0', fontSize: 11.5 }}>👤 {who(e)} · {e.count}</span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
</div>
            </div>

            <div className="glass rise" style={{ padding: 16, marginBottom: 16, minWidth: 0 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>{t('asd.byStudent')}</h2>
              <p className="muted" style={{ fontSize: 11.5, margin: '0 0 4px', whiteSpace: 'normal' }}>{t('asd.legend')} · {t('asd.cellHint')}</p>
              <p style={{ fontSize: 11.5, margin: '0 0 10px', whiteSpace: 'normal', color: 'var(--brand-blue)' }}>* {t('asd.estimateHint')}</p>
              {(() => {
                if (!picked) return null;
                const s = report.students.find((x) => x.studentId === picked.studentId);
                const d = report.days[picked.dayIdx];
                const c = s?.cells[picked.dayIdx];
                if (!s || !d || !c) return null;
                return (
                  <div className="glass hairline" style={{ padding: '12px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <b>{s.studentCode} {nm(s)}</b>
                      <span>{fmtDay(d.date, true)}</span>
                      {c.status === 'SCORED'
                        ? <span style={{ fontWeight: 750, color: scoreColor(c.scorePercent) }}>{c.scorePercent}%{c.rawScore != null ? ` (${c.rawScore}/${c.rawMax})` : ''}</span>
                        : <span style={{ fontWeight: 700, color: cellColor(c) }}>{t(`asd.status.${c.status}`)}</span>}
                      {c.criticalFailed && <span className="chip chip-danger">⚠ {t('asd.critical')}</span>}
                      {c.evaluator && (
                        <span>{t('asd.by')}: <b>👤 {who(c.evaluator)}</b>
                          {c.evaluator.email && who(c.evaluator) !== c.evaluator.email ? <span className="muted"> ({c.evaluator.email})</span> : null}
                          {c.at ? <span className="muted"> · {t('asd.savedAt')} {fmtAt(c.at)}</span> : null}
                        </span>
                      )}
                      <button onClick={() => setPicked(null)} aria-label={t('common.close')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-1)', fontSize: 16 }}>×</button>
                    </div>
                    {c.sectionScores && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 16px', marginTop: 10 }}>
                        {rb.sections.map((sec, si) => {
                          const v = c.sectionScores![si];
                          return (
                            <div key={sec.id}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nm(sec)}>{si + 1}. {nm(sec)}</span>
                                <b style={{ color: scoreColor(v) }}>{v != null ? `${v}%` : '—'}</b>
                              </div>
                              <div style={{ height: 5, borderRadius: 3, background: 'var(--glass-hairline)', overflow: 'hidden', marginTop: 3 }}>
                                <div style={{ height: '100%', width: `${Math.min(100, v ?? 0)}%`, background: scoreColor(v) }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {c.note && <div style={{ marginTop: 8 }}><span className="muted">{t('asd.note')}:</span> {c.note}</div>}
                    {c.ratings && Object.keys(c.ratings).length > 0 && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 12.5 }}>{t('asd.items')}</summary>
                        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {rb.sections.map((sec) => sec.items.filter((it) => c.ratings![it.id] != null).map((it) => {
                            const failed = c.failedCritical.includes(it.id);
                            return (
                              <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '2px 0', borderBottom: '1px dashed var(--glass-hairline)' }}>
                                <span style={{ whiteSpace: 'normal', color: failed ? 'var(--danger)' : undefined }}>{it.isCritical ? '★ ' : ''}{lang === 'th' ? it.textTh ?? it.textEn : it.textEn}</span>
                                <b style={{ whiteSpace: 'nowrap' }}>{c.ratings![it.id]}/{it.maxRating}</b>
                              </div>
                            );
                          }))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })()}
              <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                <thead><tr>
                  <th style={{ ...th, ...sticky }}>{t('asd.student')}</th>
                  {report.days.map((d) => <th key={d.sessionId} style={{ ...th, textAlign: 'center', fontSize: 11, opacity: d.upcoming && d.assessed === 0 ? 0.5 : 1 }}>{fmtDay(d.date)}</th>)}
                  <th style={{ ...th, textAlign: 'right' }}>{t('asd.dayAvg')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('asd.comp')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('asd.points')} /{rb.weightPercent}</th>
                  <th style={{ ...th, textAlign: 'center', color: 'var(--brand-blue)' }} title={t('asd.estimateHint')}>{t('asd.estimate')}*</th>
                </tr></thead>
                <tbody>
                  {report.students.map((s) => (
                    <tr key={s.studentId}>
                      <td style={{ ...td, ...sticky }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{s.studentCode}</span> {nm(s)}
                        {s.criticalFailed && <span title={t('asd.critical')} style={{ marginLeft: 4, color: 'var(--danger)' }}>⚠</span>}
                      </td>
                      {s.cells.map((c, di) => {
                        const on = picked?.studentId === s.studentId && picked.dayIdx === di;
                        const clickable = c.status !== 'UPCOMING';
                        return (
                          <td key={report.days[di].sessionId}
                            title={c.status === 'SCORED' && c.evaluator ? `${t('asd.by')}: ${who(c.evaluator)}${c.at ? ` · ${fmtAt(c.at)}` : ''}` : t(`asd.status.${c.status}`)}
                            onClick={clickable ? () => setPicked(on ? null : { studentId: s.studentId, dayIdx: di }) : undefined}
                            style={{ ...td, textAlign: 'center', fontWeight: 700, cursor: clickable ? 'pointer' : 'default', color: cellColor(c),
                              background: on ? 'var(--glass-hairline)' : undefined }}>
                            {cellText(c)}
                          </td>
                        );
                      })}
                      <td style={{ ...td, textAlign: 'right', fontWeight: 750, color: scoreColor(s.dayAverage) }}>{s.dayAverage ?? '—'}</td>
                      <td className="muted" style={{ ...td, textAlign: 'right' }} title={`${s.assessedDays}/${s.countedDays}`}>{s.component ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{s.points ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'center' }} title={s.estimate ? `${t('asd.estimateHint')} · ${s.estimate.basisWeight}/${s.estimate.totalWeight}%` : undefined}>
                        {s.estimate ? (
                          <span className="chip" style={{ fontWeight: 750, color: 'var(--brand-blue)', border: '1px dashed var(--brand-blue)', background: 'transparent' }}>
                            ~{s.estimate.grade ?? '—'} <span style={{ fontWeight: 500, fontSize: 11.5 }}>({s.estimate.estimate})</span>
                          </span>
                        ) : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
</div>
            </div>

            {rb.sections.length > 0 && (
              <div className="glass rise" style={{ padding: 16, minWidth: 0 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>{t('asd.byCategory')}</h2>
                <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                  <thead><tr>
                    <th style={{ ...th, ...sticky }}>{t('asd.student')}</th>
                    {rb.sections.map((sec, i) => (
                      <th key={sec.id} title={nm(sec)} style={{ ...th, textAlign: 'center', whiteSpace: 'normal', minWidth: 90, maxWidth: 150, fontSize: 11.5 }}>
                        {i + 1}. {nm(sec)}{sec.weightPercent ? <span className="muted" style={{ fontWeight: 500 }}> ({Math.round(sec.weightPercent * 100) / 100}%)</span> : null}
                      </th>
                    ))}
                    <th style={{ ...th, textAlign: 'right' }}>{t('asd.dayAvg')}</th>
                  </tr></thead>
                  <tbody>
                    {report.students.map((s) => (
                      <tr key={s.studentId}>
                        <td style={{ ...td, ...sticky }}><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{s.studentCode}</span> {nm(s)}</td>
                        {s.sectionAverages.map((v, i) => <td key={rb.sections[i].id} style={{ ...td, textAlign: 'center', fontWeight: 650, color: scoreColor(v) }}>{v ?? '—'}</td>)}
                        <td style={{ ...td, textAlign: 'right', fontWeight: 750, color: scoreColor(s.dayAverage) }}>{s.dayAverage ?? '—'}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...td, ...sticky, fontWeight: 750 }}>{t('asd.groupAvg')}</td>
                      {rb.sections.map((sec, si) => {
                        const xs = report.students.map((s) => s.sectionAverages[si]).filter((v): v is number => v != null);
                        const v = xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
                        return <td key={sec.id} style={{ ...td, textAlign: 'center', fontWeight: 750, color: scoreColor(v) }}>{v ?? '—'}</td>;
                      })}
                      <td style={{ ...td, textAlign: 'right', fontWeight: 750, color: scoreColor(totals.average) }}>{totals.average ?? '—'}</td>
                    </tr>
                  </tbody>
                </table>
</div>
              </div>
            )}
          </>
        )}
      </div>
      {previewUrl && <PdfPreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}
