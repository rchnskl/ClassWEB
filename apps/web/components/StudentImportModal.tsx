'use client';

import { useRef, useState } from 'react';
import { downloadFile, uploadFile } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ProgramRef { id: string; code: string; nameEn: string }

interface ImportRow {
  row: number;
  studentCode: string;
  nameEn: string;
  nameTh: string | null;
  yearLevel: number | null;
  action: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';
  errors: string[];
}
interface ImportSummary {
  fileName: string;
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  errors: number;
  committed: boolean;
  importBatch?: string;
  rows: ImportRow[];
}

/**
 * Two-step roster import: always preview first, commit second. The preview is
 * a real server-side validation pass (nothing is written), so what the user
 * confirms is exactly what will land.
 */
export default function StudentImportModal({
  programs, onClose, onImported,
}: { programs: ProgramRef[]; onClose: () => void; onImported: () => void }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);

  const [programId, setProgramId] = useState(programs[0]?.id ?? '');
  const [yearLevel, setYearLevel] = useState('');
  const [onDuplicate, setOnDuplicate] = useState<'SKIP' | 'UPDATE'>('SKIP');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);

  function buildForm(commit: boolean): FormData {
    const form = new FormData();
    form.append('file', file!);
    form.append('programId', programId);
    if (yearLevel) form.append('yearLevel', yearLevel);
    form.append('onDuplicate', onDuplicate);
    form.append('commit', String(commit));
    return form;
  }

  async function run(commit: boolean) {
    if (!file || !programId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadFile<ImportSummary>('/students/import', buildForm(commit));
      if (commit) { setDone(result); onImported(); } else { setPreview(result); }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('imp.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function getTemplate() {
    try {
      await downloadFile('/students/import/template.xlsx', 'classweb-student-import-template.xlsx');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('imp.failed'));
    }
  }

  const canCommit = preview !== null && preview.errors === 0 && (preview.toCreate + preview.toUpdate) > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('imp.title')}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(8,12,20,0.55)', backdropFilter: 'blur(4px)',
        display: 'grid', placeItems: 'center', zIndex: 60, padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass" style={{ width: 'min(920px, 100%)', maxHeight: '88vh', overflow: 'auto', borderRadius: 18, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 720 }}>{t('imp.title')}</h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5 }}>{t('imp.subtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="glass hairline icon-btn"
            style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: 'var(--text-1)' }}>✕</button>
        </div>

        {done ? (
          <div>
            <div className="chip chip-success" style={{ borderRadius: 12, padding: '10px 14px', display: 'block', marginBottom: 14 }}>
              {t('imp.doneCreated')}: <strong>{done.toCreate}</strong> · {t('imp.doneUpdated')}: <strong>{done.toUpdate}</strong> · {t('imp.doneSkipped')}: <strong>{done.toSkip}</strong>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 16px' }}>{t('imp.batchRef')}: <code>{done.importBatch}</code></p>
            <button className="btn-primary" style={{ padding: '11px 18px' }} onClick={onClose}>{t('common.close')}</button>
          </div>
        ) : (
          <>
            {/* ---- step 1: what and where ---- */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
              <label style={{ display: 'block' }}>
                <span className="subtle" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('imp.program')} *</span>
                <select className="input" value={programId} onChange={(e) => { setProgramId(e.target.value); setPreview(null); }}>
                  {programs.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameEn}</option>)}
                </select>
              </label>
              <label style={{ display: 'block' }}>
                <span className="subtle" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('imp.defaultYear')}</span>
                <select className="input" value={yearLevel} onChange={(e) => { setYearLevel(e.target.value); setPreview(null); }}>
                  <option value="">{t('imp.fromFile')}</option>
                  {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{t('common.year')} {y}</option>)}
                </select>
              </label>
              <label style={{ display: 'block' }}>
                <span className="subtle" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('imp.onDuplicate')}</span>
                <select className="input" value={onDuplicate} onChange={(e) => { setOnDuplicate(e.target.value as 'SKIP' | 'UPDATE'); setPreview(null); }}>
                  <option value="SKIP">{t('imp.dupSkip')}</option>
                  <option value="UPDATE">{t('imp.dupUpdate')}</option>
                </select>
              </label>
            </div>

            <div className="glass hairline" style={{ borderRadius: 14, padding: 14, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label={t('imp.chooseFile')}
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(null); }}
                style={{ fontSize: 13.5, color: 'var(--text-1)', flex: 1, minWidth: 200 }}
              />
              <button type="button" onClick={getTemplate} className="glass hairline"
                style={{ padding: '9px 14px', borderRadius: 11, fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                ⬇ {t('imp.template')}
              </button>
            </div>

            {error && <div className="chip chip-danger" role="alert" style={{ display: 'block', borderRadius: 12, padding: '10px 13px', marginBottom: 14 }}>{error}</div>}

            {/* ---- step 2: preview ---- */}
            {preview && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <Stat label={t('imp.rows')} value={preview.totalRows} />
                  <Stat label={t('imp.willCreate')} value={preview.toCreate} tone="success" />
                  <Stat label={t('imp.willUpdate')} value={preview.toUpdate} tone={preview.toUpdate ? 'warning' : undefined} />
                  <Stat label={t('imp.willSkip')} value={preview.toSkip} />
                  <Stat label={t('imp.rowErrors')} value={preview.errors} tone={preview.errors ? 'danger' : undefined} />
                </div>

                {preview.errors > 0 && (
                  <div className="chip chip-danger" role="alert" style={{ display: 'block', borderRadius: 12, padding: '10px 13px', marginBottom: 10 }}>
                    {t('imp.mustFix')}
                  </div>
                )}

                <div style={{ maxHeight: 320, overflow: 'auto', borderRadius: 12, border: '1px solid var(--glass-hairline)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-2)', position: 'sticky', top: 0, background: 'var(--surface-1, rgba(20,26,38,0.96))' }}>
                        <th style={thStyle}>{t('imp.row')}</th>
                        <th style={thStyle}>{t('students.studentId')}</th>
                        <th style={thStyle}>{t('students.name')}</th>
                        <th style={thStyle}>{t('common.year')}</th>
                        <th style={thStyle}>{t('imp.result')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={r.row} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                          <td style={tdStyle}><span style={{ fontFamily: 'ui-monospace, monospace' }}>{r.row}</span></td>
                          <td style={tdStyle}><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.studentCode || '—'}</span></td>
                          <td style={tdStyle}>
                            <div>{r.nameEn || <span className="muted">—</span>}</div>
                            {r.nameTh && <div className="muted" style={{ fontSize: 12 }}>{r.nameTh}</div>}
                          </td>
                          <td style={tdStyle}>{r.yearLevel ?? <span className="muted">—</span>}</td>
                          <td style={tdStyle}>
                            <ActionChip action={r.action} t={t} />
                            {r.errors.length > 0 && (
                              <div style={{ fontSize: 12, marginTop: 4, color: r.action === 'ERROR' ? 'var(--danger, #ff6b6b)' : 'var(--text-2)' }}>
                                {r.errors.join(' · ')}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="glass hairline"
                disabled={!file || !programId || busy}
                onClick={() => run(false)}
                style={{ padding: '11px 18px', borderRadius: 12, fontWeight: 650, fontSize: 14, color: 'var(--text-1)', opacity: !file || busy ? 0.55 : 1, cursor: !file || busy ? 'not-allowed' : 'pointer' }}
              >
                {busy && !preview ? t('imp.checking') : t('imp.check')}
              </button>
              <button
                className="btn-primary"
                disabled={!canCommit || busy}
                onClick={() => run(true)}
                style={{ padding: '11px 18px', fontSize: 14, opacity: !canCommit || busy ? 0.55 : 1, cursor: !canCommit || busy ? 'not-allowed' : 'pointer' }}
              >
                {busy && preview ? t('imp.importing') : t('imp.confirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '9px 11px', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 };
const tdStyle: React.CSSProperties = { padding: '9px 11px', verticalAlign: 'top' };

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'danger' }) {
  const cls = tone ? `chip chip-${tone}` : 'chip';
  return (
    <span className={cls} style={tone ? undefined : { background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>
      {label}: <strong style={{ marginLeft: 4 }}>{value}</strong>
    </span>
  );
}

function ActionChip({ action, t }: { action: ImportRow['action']; t: (k: string) => string }) {
  const map = {
    CREATE: { cls: 'chip-success', key: 'imp.actCreate' },
    UPDATE: { cls: 'chip-warning', key: 'imp.actUpdate' },
    SKIP: { cls: 'chip', key: 'imp.actSkip' },
    ERROR: { cls: 'chip-danger', key: 'imp.actError' },
  }[action];
  return (
    <span className={`chip ${map.cls}`} style={map.cls === 'chip' ? { background: 'var(--glass-hairline)', color: 'var(--text-1)' } : undefined}>
      {t(map.key)}
    </span>
  );
}
