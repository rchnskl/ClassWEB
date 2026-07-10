'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import GradingDrawer, { type Rubric } from '@/components/GradingDrawer';
import RubricBuilderDrawer from '@/components/RubricBuilderDrawer';
import { apiFetch, downloadFile } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface SectionRef { id: string; sectionNo: string; subject: { id: string; code: string; nameEn: string } }
interface Row { studentId: string; studentCode: string; nameEn: string; nameTh: string | null; total: number; gradedWeight: number; gradedCount: number; grade: string | null; gpa: number | null }
interface SectionSummary { section: { sectionNo: string; subject: { code: string; nameEn: string } }; rubricCount: number; students: Row[] }
interface Band { id: string; grade: string; gpa: number; label: string; minScore: number }
interface RubricConfigRow { rubricId: string; code: string; nameEn: string; nameTh: string | null; weightPercent: number; isActive: boolean }

const GRADE_COLOR = (g: string | null) =>
  g == null ? 'var(--text-2)' : g.startsWith('A') ? 'var(--success)' : g.startsWith('B') ? 'var(--brand-blue)' : g.startsWith('C') ? 'var(--warning)' : 'var(--danger)';

export default function AssessmentPage() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [email, setEmail] = useState('admin@nursing.au.edu');
  const [sections, setSections] = useState<SectionRef[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [summary, setSummary] = useState<SectionSummary | null>(null);
  const [grading, setGrading] = useState<Row | null>(null);
  const [scheme, setScheme] = useState<Band[] | null>(null);
  const [showScheme, setShowScheme] = useState(false);
  const [savingScheme, setSavingScheme] = useState(false);
  const [rubricConfig, setRubricConfig] = useState<RubricConfigRow[] | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);

  async function exportSection(fmt: 'pdf' | 'xlsx' | 'csv') {
    if (!sectionId) return;
    setExporting(`section-${fmt}`);
    try { await downloadFile(`/reports/grades/section/${sectionId}/${fmt}`, `section-grades.${fmt}`); }
    catch { /* ignore */ } finally { setExporting(null); }
  }
  async function exportStudent(studentId: string) {
    setExporting(`student-${studentId}`);
    try { await downloadFile(`/reports/grades/student/${studentId}/pdf?sectionId=${sectionId}`, `grade-report.pdf`); }
    catch { /* ignore */ } finally { setExporting(null); }
  }

  const currentSubjectId = sections.find((s) => s.id === sectionId)?.subject.id ?? '';

  const loadSummary = useCallback(async (sid: string) => {
    if (!sid) return;
    try { setSummary(await apiFetch<SectionSummary>(`/assessment/sections/${sid}/summary`)); } catch { setSummary(null); }
  }, []);

  const loadRubrics = useCallback(async (subjectId: string) => {
    if (!subjectId) { setRubrics([]); return; }
    try { setRubrics(await apiFetch<Rubric[]>(`/assessment/subjects/${subjectId}/rubrics`)); } catch { setRubrics([]); }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
    apiFetch<{ items: SectionRef[] }>('/sections').then((d) => {
      setSections(d.items);
      if (d.items[0]) {
        setSectionId(d.items[0].id);
        void loadSummary(d.items[0].id);
        void loadRubrics(d.items[0].subject.id);
      }
    }).catch(() => {});
  }, [router, loadSummary, loadRubrics]);

  function pickSection(id: string) {
    setSectionId(id);
    void loadSummary(id);
    const subjectId = sections.find((s) => s.id === id)?.subject.id;
    if (subjectId) void loadRubrics(subjectId);
  }

  async function openScheme() {
    const s = await apiFetch<{ bands: Band[] }>('/assessment/grade-scheme');
    setScheme(s.bands);
    setShowScheme(true);
  }
  async function saveScheme() {
    if (!scheme) return;
    setSavingScheme(true);
    try {
      await apiFetch('/assessment/grade-scheme', { method: 'PATCH', body: JSON.stringify({ bands: scheme.map((b) => ({ id: b.id, minScore: b.minScore })) }) });
      setShowScheme(false);
      await loadSummary(sectionId);
    } finally { setSavingScheme(false); }
  }

  async function openConfig() {
    if (!currentSubjectId) return;
    const rows = await apiFetch<RubricConfigRow[]>(`/assessment/subjects/${currentSubjectId}/rubric-config`);
    setRubricConfig(rows);
    setShowConfig(true);
  }
  const activeSum = rubricConfig ? rubricConfig.filter((r) => r.isActive).reduce((a, r) => a + r.weightPercent, 0) : 0;
  async function saveConfig() {
    if (!rubricConfig || !currentSubjectId) return;
    setSavingConfig(true);
    try {
      await apiFetch(`/assessment/subjects/${currentSubjectId}/rubric-config`, {
        method: 'PATCH',
        body: JSON.stringify({ rubrics: rubricConfig.map((r) => ({ rubricId: r.rubricId, weightPercent: r.weightPercent, isActive: r.isActive })) }),
      });
      setShowConfig(false);
      await loadRubrics(currentSubjectId);
      await loadSummary(sectionId);
    } finally { setSavingConfig(false); }
  }

  return (
    <div className="app-shell">
      <Sidebar active="Assessment" />
      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('as.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('as.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="input" value={sectionId} onChange={(e) => pickSection(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.subject.code} · {s.sectionNo}</option>)}
            </select>
            <button className="glass hairline" style={{ padding: '9px 14px', borderRadius: 12, fontWeight: 650, fontSize: 13.5, color: 'var(--text-1)', cursor: 'pointer' }} onClick={() => setShowBuilder(true)}>{t('rubric.manageBtn')}</button>
            <button className="glass hairline" style={{ padding: '9px 14px', borderRadius: 12, fontWeight: 650, fontSize: 13.5, color: 'var(--text-1)', cursor: 'pointer' }} onClick={openConfig}>📋 {t('as.configRubrics')}</button>
            <button className="glass hairline" style={{ padding: '9px 14px', borderRadius: 12, fontWeight: 650, fontSize: 13.5, color: 'var(--text-1)', cursor: 'pointer' }} onClick={openScheme}>⚙︎ {t('as.gradeScheme')}</button>
          </div>
        </div>

        <div className="rise" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{t('as.export')}:</span>
          <ExportBtn label="📄 PDF" busy={exporting === 'section-pdf'} onClick={() => exportSection('pdf')} primary />
          <ExportBtn label="📊 Excel" busy={exporting === 'section-xlsx'} onClick={() => exportSection('xlsx')} />
          <ExportBtn label="📁 CSV" busy={exporting === 'section-csv'} onClick={() => exportSection('csv')} />
        </div>

        <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                  <Th>{t('students.studentId')}</Th><Th>{t('as.student')}</Th><Th>{t('as.rubrics')}</Th><Th>{t('as.total')}</Th><Th>{t('as.grade')}</Th><Th> </Th>
                </tr>
              </thead>
              <tbody>
                {!summary || summary.students.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('as.noStudents')}</td></tr>
                ) : summary.students.map((s) => (
                  <tr key={s.studentId} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                    <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{s.studentCode}</span></Td>
                    <Td><span style={{ fontWeight: 600 }}>{name(s.nameEn, s.nameTh)}</span></Td>
                    <Td><span className="muted">{s.gradedCount}/{summary.rubricCount}</span></Td>
                    <Td><b>{s.total}</b><span className="muted">/100</span></Td>
                    <Td><span className="chip" style={{ background: `${GRADE_COLOR(s.grade)}22`, color: GRADE_COLOR(s.grade), fontWeight: 700 }}>{s.grade ?? '—'}{s.gpa != null ? ` · ${s.gpa.toFixed(2)}` : ''}</span></Td>
                    <Td>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => setGrading(s)} className="btn-primary" style={{ padding: '6px 14px', fontSize: 12.5 }}>{t('as.grade_btn')}</button>
                        <button onClick={() => exportStudent(s.studentId)} disabled={exporting === `student-${s.studentId}`}
                          className="glass hairline icon-btn" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', cursor: exporting === `student-${s.studentId}` ? 'wait' : 'pointer' }}
                          title={t('as.exportStudent')}>
                          {exporting === `student-${s.studentId}` ? '…' : '📄'}
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showBuilder && (
        <RubricBuilderDrawer
          onClose={() => setShowBuilder(false)}
          onChanged={() => { void loadSummary(sectionId); if (currentSubjectId) void loadRubrics(currentSubjectId); }}
        />
      )}

      {grading && sectionId && (
        <GradingDrawer
          studentId={grading.studentId} sectionId={sectionId}
          studentName={name(grading.nameEn, grading.nameTh)}
          rubrics={rubrics}
          onClose={() => setGrading(null)}
          onSaved={() => loadSummary(sectionId)}
        />
      )}

      {showScheme && scheme && (
        <div onClick={() => setShowScheme(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(6,10,20,0.5)', backdropFilter: 'blur(3px)', zIndex: 1100, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: 'min(460px, 100%)', maxHeight: '86vh', overflowY: 'auto', background: 'var(--popover-bg)', border: '1px solid var(--glass-hairline)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{t('as.gradeScheme')}</h2>
              <button onClick={() => setShowScheme(false)} className="glass hairline icon-btn" style={{ width: 32, height: 32, fontSize: 17 }}>×</button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 14px' }}>{t('as.schemeHint')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {scheme.map((b, i) => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--popover-hover)' }}>
                  <span style={{ width: 34, fontWeight: 800, color: GRADE_COLOR(b.grade) }}>{b.grade}</span>
                  <span style={{ width: 40, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{b.gpa.toFixed(2)}</span>
                  <span className="muted" style={{ flex: 1, fontSize: 12 }}>{b.label}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>≥</span>
                  <input type="number" min={0} max={100} value={b.minScore}
                    onChange={(e) => { const v = Number(e.target.value); setScheme(scheme.map((x, xi) => xi === i ? { ...x, minScore: v } : x)); }}
                    style={{ width: 64, padding: '6px 8px', fontSize: 13, textAlign: 'right', borderRadius: 8, border: '1px solid var(--glass-hairline)', background: 'transparent', color: 'var(--text-0)' }} />
                </div>
              ))}
            </div>
            <button className="btn-primary" onClick={saveScheme} disabled={savingScheme} style={{ width: '100%', padding: 12, fontSize: 14.5, marginTop: 16 }}>{savingScheme ? t('as.saving') : t('as.save')}</button>
          </div>
        </div>
      )}

      {showConfig && rubricConfig && (
        <div onClick={() => setShowConfig(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(6,10,20,0.5)', backdropFilter: 'blur(3px)', zIndex: 1100, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: 'min(480px, 100%)', maxHeight: '86vh', overflowY: 'auto', background: 'var(--popover-bg)', border: '1px solid var(--glass-hairline)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{t('as.configRubrics')} · {sections.find((s) => s.id === sectionId)?.subject.code}</h2>
              <button onClick={() => setShowConfig(false)} className="glass hairline icon-btn" style={{ width: 32, height: 32, fontSize: 17 }}>×</button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 14px' }}>{t('as.configHint')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rubricConfig.map((r, i) => (
                <div key={r.rubricId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: r.isActive ? 'var(--popover-hover)' : 'transparent', border: '1px solid var(--glass-hairline)', opacity: r.isActive ? 1 : 0.55 }}>
                  <input type="checkbox" checked={r.isActive} title={t('as.active')}
                    onChange={(e) => setRubricConfig(rubricConfig.map((x, xi) => xi === i ? { ...x, isActive: e.target.checked } : x))}
                    style={{ width: 17, height: 17, cursor: 'pointer' }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{name(r.nameEn, r.nameTh)}</span>
                  <input type="number" min={0} max={100} value={r.weightPercent} disabled={!r.isActive}
                    onChange={(e) => setRubricConfig(rubricConfig.map((x, xi) => xi === i ? { ...x, weightPercent: Number(e.target.value) } : x))}
                    style={{ width: 60, padding: '6px 8px', fontSize: 13, textAlign: 'right', borderRadius: 8, border: '1px solid var(--glass-hairline)', background: 'transparent', color: 'var(--text-0)' }} />
                  <span className="muted" style={{ fontSize: 11.5, width: 14 }}>%</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '8px 10px', fontSize: 13, fontWeight: 700 }}>
              <span>{t('as.sumActive')}</span>
              <span style={{ color: activeSum > 100 ? 'var(--danger)' : 'var(--success)' }}>{activeSum}% {activeSum > 100 ? `· ${t('as.overLimit')}` : ''}</span>
            </div>
            <button className="btn-primary" onClick={saveConfig} disabled={savingConfig || activeSum > 100} style={{ width: '100%', padding: 12, fontSize: 14.5, marginTop: 10 }}>{savingConfig ? t('as.saving') : t('as.save')}</button>
          </div>
        </div>
      )}
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

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '12px 14px', fontWeight: 600, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '12px 14px' }}>{children}</td>;
}
