'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { IconSearch, IconStudents } from '@/components/icons';
import StudentNotesDrawer from '@/components/StudentNotesDrawer';
import PdfPreviewModal from '@/components/PdfPreviewModal';
import StudentImportModal from '@/components/StudentImportModal';
import { apiFetch, downloadFile, fetchPreviewUrl, type MeResponse, type Paginated } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface StudentRow {
  id: string;
  studentCode: string;
  nameEn: string;
  nameTh?: string | null;
  nickname?: string | null;
  gender: string;
  status: string;
  admissionYear?: number | null;
  yearLevel?: number | null;
  program: { id: string; code: string; nameEn: string };
}
interface ProgramRef { id: string; code: string; nameEn: string }
interface PromotePreview { affected: number; heldBack: number; graduating: boolean; toYear: number | null }

const PAGE = 10;
const YEARS = [1, 2, 3, 4];
const EMPTY_FORM = { studentCode: '', nameEn: '', nameTh: '', nickname: '', programId: '', gender: 'FEMALE', status: 'STUDYING', yearLevel: '' };

export default function StudentsPage() {
  return (
    <Suspense fallback={null}>
      <StudentsPageInner />
    </Suspense>
  );
}

function StudentsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [yearFilter, setYearFilter] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [promote, setPromote] = useState<{ fromYear: string; preview: PromotePreview | null; busy: boolean; error: string | null } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [programs, setPrograms] = useState<ProgramRef[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<StudentRow | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function downloadReport(s: StudentRow) {
    setReporting(s.id);
    try {
      await downloadFile(`/reports/student/${s.id}/pdf`, `${s.studentCode}.pdf`);
    } catch { /* ignore */ } finally {
      setReporting(null);
    }
  }

  async function previewReport(s: StudentRow) {
    setPreviewing(s.id);
    try {
      setPreviewUrl(await fetchPreviewUrl(`/reports/student/${s.id}/pdf`));
    } catch { /* ignore */ } finally {
      setPreviewing(null);
    }
  }

  const load = useCallback(async (nextSkip: number, q: string, year = yearFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ take: String(PAGE), skip: String(nextSkip) });
      if (q) params.set('search', q);
      if (year) params.set('yearLevel', year);
      const data = await apiFetch<Paginated<StudentRow>>(`/students?${params.toString()}`);
      setRows(data.items);
      setTotal(data.total);
      setSkip(nextSkip);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }, [yearFilter]);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) {
      router.replace('/login');
      return;
    }
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
    apiFetch<MeResponse>('/users/me')
      .then((me) => setIsAdmin(me.roles.some((r) => r.role.code === 'ADMIN')))
      .catch(() => {});
    apiFetch<ProgramRef[]>('/programs').then(setPrograms).catch(() => {});
    // Arriving from the global search box: prefill and run that search immediately.
    const fromSearch = searchParams.get('search');
    if (fromSearch) setSearch(fromSearch);
    void load(0, fromSearch ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Debounced search; the year filter re-queries immediately.
  useEffect(() => {
    const t = setTimeout(() => void load(0, search, yearFilter), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, yearFilter]);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, yearLevel: yearFilter });
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row: StudentRow) {
    setEditingId(row.id);
    setForm({
      studentCode: row.studentCode, nameEn: row.nameEn, nameTh: row.nameTh ?? '', nickname: row.nickname ?? '',
      programId: row.program.id ?? '', gender: row.gender, status: row.status,
      yearLevel: row.yearLevel != null ? String(row.yearLevel) : '',
    });
    setFormError(null);
    setShowForm(true);
  }

  async function runPromote(commit: boolean) {
    if (!promote) return;
    setPromote({ ...promote, busy: true, error: null });
    try {
      const res = await apiFetch<PromotePreview>('/students/promote-year', {
        method: 'POST',
        body: JSON.stringify({ fromYear: Number(promote.fromYear), finalYear: 4, commit }),
      });
      if (commit) {
        setPromote(null);
        await load(0, search, yearFilter);
      } else {
        setPromote({ ...promote, preview: res, busy: false, error: null });
      }
    } catch (err) {
      setPromote({ ...promote, busy: false, error: err instanceof Error ? err.message : t('promo.failed') });
    }
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      // yearLevel is a <select> string; the API wants a number or nothing at all.
      const { yearLevel, ...rest } = form;
      const payload = { ...rest, ...(yearLevel ? { yearLevel: Number(yearLevel) } : {}) };
      if (editingId) {
        await apiFetch(`/students/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/students', { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load(skip, search);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save student');
    } finally {
      setSaving(false);
    }
  }

  async function removeStudent(row: StudentRow) {
    if (!window.confirm(t('students.confirmDelete'))) return;
    setBusyId(row.id);
    try {
      await apiFetch(`/students/${row.id}`, { method: 'DELETE' });
      await load(skip, search);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete student');
    } finally {
      setBusyId(null);
    }
  }

  const page = Math.floor(skip / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="app-shell">
      <Sidebar active="Students" />

      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('students.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>
              {total} {t('students.count')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isAdmin && (
              <>
                <button className="glass hairline" style={{ padding: '11px 16px', fontSize: 14, borderRadius: 12, fontWeight: 650, color: 'var(--text-1)' }}
                  onClick={() => setPromote({ fromYear: yearFilter || '1', preview: null, busy: false, error: null })}>
                  ⬆ {t('promo.button')}
                </button>
                <button className="glass hairline" style={{ padding: '11px 16px', fontSize: 14, borderRadius: 12, fontWeight: 650, color: 'var(--text-1)' }}
                  onClick={() => setShowImport(true)}>
                  ⬆ {t('imp.button')}
                </button>
              </>
            )}
            <button className="btn-primary" style={{ padding: '11px 18px', fontSize: 14.5 }} onClick={() => (showForm ? setShowForm(false) : openCreate())}>
              {showForm ? t('students.close') : t('students.add')}
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={submitForm} className="glass rise" style={{ padding: 20, marginBottom: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
            <Field label={`${t('students.studentId')} *`}><input className="input" required value={form.studentCode} onChange={(e) => setForm({ ...form, studentCode: e.target.value })} placeholder="6510100" /></Field>
            <Field label={`${t('students.englishName')} *`}><input className="input" required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} placeholder="Full name" /></Field>
            <Field label={t('students.nickname')}><input className="input" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="—" /></Field>
            <Field label={`${t('students.program')} *`}>
              <select className="input" required value={form.programId} onChange={(e) => setForm({ ...form, programId: e.target.value })}>
                <option value="" disabled>{t('students.select')}</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameEn}</option>)}
              </select>
            </Field>
            <Field label={t('students.gender')}>
              <select className="input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="FEMALE">{t('students.female')}</option><option value="MALE">{t('students.male')}</option><option value="OTHER">{t('students.other')}</option>
              </select>
            </Field>
            <Field label={t('students.yearLevel')}>
              <select className="input" value={form.yearLevel} onChange={(e) => setForm({ ...form, yearLevel: e.target.value })}>
                <option value="">{t('students.noYear')}</option>
                {YEARS.map((y) => <option key={y} value={y}>{t('common.year')} {y}</option>)}
              </select>
            </Field>
            {editingId && (
              <Field label={t('students.status')}>
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="STUDYING">STUDYING</option>
                  <option value="ON_LEAVE">ON_LEAVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="GRADUATED">GRADUATED</option>
                  <option value="WITHDRAWN">WITHDRAWN</option>
                  <option value="DISMISSED">DISMISSED</option>
                </select>
              </Field>
            )}
            <button className="btn-primary" type="submit" disabled={saving} style={{ padding: '12px', fontSize: 14.5 }}>{saving ? t('students.saving') : editingId ? t('subj.save') : t('students.create')}</button>
            {formError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{formError}</div>}
          </form>
        )}

        {/* Search + year filter */}
        <div className="rise" style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="glass hairline" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderRadius: 14, color: 'var(--text-2)', flex: '1 1 260px', maxWidth: 420 }}>
            <IconSearch />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('students.search')}
              style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-0)', fontSize: 14, width: '100%' }}
            />
          </div>
          <select className="input" aria-label={t('students.filterYear')} value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="">{t('students.allYears')}</option>
            {YEARS.map((y) => <option key={y} value={y}>{t('common.year')} {y}</option>)}
          </select>
        </div>

        <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
          {error && <div className="chip chip-danger" style={{ margin: 12 }}>{error}</div>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                  <Th>{t('students.studentId')}</Th><Th>{t('students.name')}</Th><Th>{t('students.nickname')}</Th><Th>{t('students.program')}</Th><Th>{t('students.year')}</Th><Th>{t('students.status')}</Th><Th> </Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('common.loading')}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 48, textAlign: 'center' }}>
                    <div className="brand-gradient floaty" style={{ width: 46, height: 46, borderRadius: 14, margin: '0 auto 12px', display: 'grid', placeItems: 'center' }}><IconStudents width={22} height={22} /></div>
                    <div style={{ fontWeight: 650 }}>{t('students.none')}</div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t('students.noneHint')}</div>
                  </td></tr>
                ) : rows.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                    <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{s.studentCode}</span></Td>
                    <Td>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.nameEn}</div>
                      {s.nameTh && <div className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{s.nameTh}</div>}
                    </Td>
                    <Td>{s.nickname || <span className="muted">—</span>}</Td>
                    <Td><span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>{s.program.code}</span></Td>
                    <Td>
                      {s.yearLevel != null
                        ? <span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>{t('common.year')} {s.yearLevel}</span>
                        : <span className="muted">—</span>}
                    </Td>
                    <Td><StatusChip status={s.status} t={t} /></Td>
                    <Td>
                      {/* Uniform icon buttons on a single line — with five
                          labelled actions this column wrapped one button per
                          row once real names widened the name column. */}
                      <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'nowrap' }}>
                        <RowAction onClick={() => setNotesFor(s)} title={t('students.notes')}>📝</RowAction>
                        <RowAction onClick={() => previewReport(s)} busy={previewing === s.id} title={t('common.previewPdf')}>👁</RowAction>
                        <RowAction onClick={() => downloadReport(s)} busy={reporting === s.id} title={t('students.report')}>📄</RowAction>
                        <RowAction onClick={() => openEdit(s)} title={t('students.edit')}>✏️</RowAction>
                        <RowAction onClick={() => removeStudent(s)} busy={busyId === s.id} title={t('students.delete')} danger>🗑</RowAction>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
            <span className="muted" style={{ fontSize: 13 }}>{t('common.page')} {page} {t('common.of')} {pages}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <PagerBtn disabled={skip === 0 || loading} onClick={() => load(Math.max(0, skip - PAGE), search)}>{t('common.previous')}</PagerBtn>
              <PagerBtn disabled={skip + PAGE >= total || loading} onClick={() => load(skip + PAGE, search)}>{t('common.next')}</PagerBtn>
            </div>
          </div>
        </div>
      </div>

      {notesFor && (
        <StudentNotesDrawer
          studentId={notesFor.id}
          studentName={notesFor.nameEn}
          studentCode={notesFor.studentCode}
          onClose={() => setNotesFor(null)}
        />
      )}

      {previewUrl && <PdfPreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />}

      {showImport && (
        <StudentImportModal
          programs={programs}
          onClose={() => setShowImport(false)}
          onImported={() => void load(0, search, yearFilter)}
        />
      )}

      {promote && (
        <div role="dialog" aria-modal="true" aria-label={t('promo.title')}
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,12,20,0.55)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', zIndex: 60, padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setPromote(null); }}>
          <div className="glass" style={{ width: 'min(520px, 100%)', borderRadius: 18, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 720 }}>{t('promo.title')}</h2>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{t('promo.subtitle')}</p>
              </div>
              <button onClick={() => setPromote(null)} aria-label={t('common.close')} className="glass hairline icon-btn"
                style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: 'var(--text-1)' }}>✕</button>
            </div>

            <Field label={t('promo.fromYear')}>
              <select className="input" value={promote.fromYear}
                onChange={(e) => setPromote({ ...promote, fromYear: e.target.value, preview: null })}>
                {YEARS.map((y) => <option key={y} value={y}>{t('common.year')} {y}</option>)}
              </select>
            </Field>

            {promote.preview && (
              <div className={`chip ${promote.preview.graduating ? 'chip-warning' : 'chip-success'}`}
                style={{ display: 'block', borderRadius: 12, padding: '10px 13px', margin: '12px 0' }}>
                {promote.preview.graduating
                  ? <>{t('promo.willGraduate')}: <strong>{promote.preview.affected}</strong></>
                  : <>{t('promo.willMove')} {t('common.year')} {promote.preview.toYear}: <strong>{promote.preview.affected}</strong></>}
                {promote.preview.heldBack > 0 && <div style={{ fontSize: 12, marginTop: 4 }}>{t('promo.heldBack')}: {promote.preview.heldBack}</div>}
              </div>
            )}

            {promote.error && <div className="chip chip-danger" role="alert" style={{ display: 'block', borderRadius: 12, padding: '10px 13px', margin: '12px 0' }}>{promote.error}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="glass hairline" disabled={promote.busy} onClick={() => runPromote(false)}
                style={{ padding: '11px 18px', borderRadius: 12, fontWeight: 650, fontSize: 14, color: 'var(--text-1)' }}>
                {promote.busy && !promote.preview ? t('imp.checking') : t('promo.check')}
              </button>
              <button className="btn-primary" disabled={!promote.preview || promote.preview.affected === 0 || promote.busy} onClick={() => runPromote(true)}
                style={{ padding: '11px 18px', fontSize: 14, opacity: !promote.preview || promote.preview.affected === 0 ? 0.55 : 1 }}>
                {t('promo.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '12px 14px', fontWeight: 600, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '13px 14px' }}>{children}</td>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="subtle" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
function PagerBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} className="glass hairline" style={{ padding: '8px 14px', borderRadius: 12, fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}
/** Uniform square action button for a table row: icon + tooltip + accessible
 *  name, disabled with a wait cursor while its own request is in flight. */
function RowAction({
  children, onClick, title, busy, danger,
}: { children: React.ReactNode; onClick: () => void; title: string; busy?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      aria-label={title}
      className={danger ? 'btn-danger' : 'glass hairline icon-btn'}
      style={{
        width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center',
        borderRadius: 10, fontSize: 14, fontWeight: 600,
        color: danger ? undefined : 'var(--text-1)',
        cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? '…' : children}
    </button>
  );
}

function StatusChip({ status, t }: { status: string; t: (key: string) => string }) {
  const cls = status === 'STUDYING' ? 'chip-success' : status === 'GRADUATED' ? 'chip' : 'chip-warning';
  return <span className={`chip ${cls}`} style={cls === 'chip' ? { background: 'var(--glass-hairline)', color: 'var(--text-1)' } : undefined}>{t(`students.status.${status}`)}</span>;
}
