'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { IconSearch, IconTeacher } from '@/components/icons';
import { apiFetch, type Paginated } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface LecturerRow {
  id: string;
  employeeCode: string;
  nameEn: string;
  nameTh?: string | null;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  office?: string | null;
  isActive: boolean;
  department?: { id: string; code: string; nameEn: string } | null;
  _count: { primarySections: number };
}
interface DepartmentRef { id: string; code: string; nameEn: string }

const EMPTY_FORM = { employeeCode: '', nameEn: '', nameTh: '', position: '', departmentId: '', email: '', phone: '', office: '' };

const PAGE = 10;

export default function LecturersPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('admin@nursing.au.edu');
  const [rows, setRows] = useState<LecturerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [departments, setDepartments] = useState<DepartmentRef[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (nextSkip: number, q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ take: String(PAGE), skip: String(nextSkip) });
      if (q) params.set('search', q);
      const data = await apiFetch<Paginated<LecturerRow>>(`/lecturers?${params.toString()}`);
      setRows(data.items);
      setTotal(data.total);
      setSkip(nextSkip);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lecturers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
    apiFetch<DepartmentRef[]>('/departments').then(setDepartments).catch(() => {});
    void load(0, '');
  }, [router, load]);

  useEffect(() => {
    const timer = setTimeout(() => void load(0, search), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row: LecturerRow) {
    setEditingId(row.id);
    setForm({
      employeeCode: row.employeeCode, nameEn: row.nameEn, nameTh: row.nameTh ?? '',
      position: row.position ?? '', departmentId: row.department?.id ?? '',
      email: row.email ?? '', phone: row.phone ?? '', office: row.office ?? '',
    });
    setFormError(null);
    setShowForm(true);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        employeeCode: form.employeeCode,
        nameEn: form.nameEn,
        nameTh: form.nameTh || undefined,
        position: form.position || undefined,
        departmentId: form.departmentId || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        office: form.office || undefined,
      };
      if (editingId) {
        await apiFetch(`/lecturers/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch('/lecturers', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load(skip, search);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save lecturer');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: LecturerRow) {
    if (row.isActive && !window.confirm(t('lecturers.confirmDeactivate'))) return;
    setBusyId(row.id);
    try {
      await apiFetch(`/lecturers/${row.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !row.isActive }) });
      await load(skip, search);
    } finally { setBusyId(null); }
  }

  const page = Math.floor(skip / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="app-shell">
      <Sidebar active="Lecturers" />

      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('lecturers.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{total} {t('lecturers.count')}</p>
          </div>
          <button className="btn-primary" style={{ padding: '11px 18px', fontSize: 14.5 }} onClick={() => (showForm ? setShowForm(false) : openCreate())}>
            {showForm ? t('lecturers.close') : t('lecturers.add')}
          </button>
        </div>

        {showForm && (
          <form onSubmit={submitForm} className="glass rise" style={{ padding: 20, marginBottom: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
            <Field label={`${t('lecturers.employeeCode')} *`}><input className="input" required value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="EMP-0003" /></Field>
            <Field label={`${t('lecturers.englishName')} *`}><input className="input" required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} placeholder="Dr. Full Name" /></Field>
            <Field label={t('lecturers.thaiName')}><input className="input" value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} placeholder="—" /></Field>
            <Field label={t('lecturers.position')}><input className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Lecturer" /></Field>
            <Field label={t('lecturers.department')}>
              <select className="input" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">{t('lecturers.select')}</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.nameEn}</option>)}
              </select>
            </Field>
            <Field label={t('lecturers.email')}><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@au.edu" /></Field>
            <Field label={t('lecturers.phone')}><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="—" /></Field>
            <Field label={t('lecturers.office')}><input className="input" value={form.office} onChange={(e) => setForm({ ...form, office: e.target.value })} placeholder="—" /></Field>
            <button className="btn-primary" type="submit" disabled={saving} style={{ padding: '12px', fontSize: 14.5 }}>
              {saving ? t('lecturers.saving') : editingId ? t('lecturers.save') : t('lecturers.create')}
            </button>
            {formError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{formError}</div>}
          </form>
        )}

        <div className="glass hairline rise" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderRadius: 14, marginBottom: 16, color: 'var(--text-2)', maxWidth: 420 }}>
          <IconSearch />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('lecturers.search')}
            style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-0)', fontSize: 14, width: '100%' }}
          />
        </div>

        <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
          {error && <div className="chip chip-danger" style={{ margin: 12 }}>{error}</div>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                  <Th>{t('lecturers.employeeCode')}</Th><Th>{t('lecturers.name')}</Th><Th>{t('lecturers.department')}</Th><Th>{t('lecturers.sections')}</Th><Th>{t('lecturers.status')}</Th><Th> </Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('common.loading')}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 48, textAlign: 'center' }}>
                    <div className="brand-gradient floaty" style={{ width: 46, height: 46, borderRadius: 14, margin: '0 auto 12px', display: 'grid', placeItems: 'center' }}><IconTeacher width={22} height={22} /></div>
                    <div style={{ fontWeight: 650 }}>{t('lecturers.none')}</div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t('lecturers.noneHint')}</div>
                  </td></tr>
                ) : rows.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                    <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{l.employeeCode}</span></Td>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{l.nameEn}</div>
                      {l.nameTh && <div className="muted" style={{ fontSize: 12.5 }}>{l.nameTh}</div>}
                      {l.position && <div className="muted" style={{ fontSize: 12 }}>{l.position}</div>}
                    </Td>
                    <Td>{l.department ? <span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>{l.department.code}</span> : <span className="muted">—</span>}</Td>
                    <Td>{l._count.primarySections}</Td>
                    <Td><span className={`chip ${l.isActive ? 'chip-success' : 'chip-danger'}`}>{l.isActive ? t('lecturers.active') : t('lecturers.inactive')}</span></Td>
                    <Td>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => openEdit(l)} className="glass hairline icon-btn" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>
                          ✏️ {t('lecturers.edit')}
                        </button>
                        <button
                          onClick={() => toggleActive(l)}
                          disabled={busyId === l.id}
                          className={l.isActive ? 'btn-danger' : 'glass hairline'}
                          style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: busyId === l.id ? 'wait' : 'pointer' }}
                        >
                          {busyId === l.id ? '…' : l.isActive ? t('lecturers.deactivate') : t('lecturers.activate')}
                        </button>
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
