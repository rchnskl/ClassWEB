'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { IconSearch, IconStudents } from '@/components/icons';
import { apiFetch, type MeResponse, type Paginated } from '@/lib/api';
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
  program: { code: string; nameEn: string };
}
interface ProgramRef { id: string; code: string; nameEn: string }

const PAGE = 10;

export default function StudentsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('admin@nursing.au.edu');
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [programs, setPrograms] = useState<ProgramRef[]>([]);
  const [form, setForm] = useState({ studentCode: '', nameEn: '', nameTh: '', nickname: '', programId: '', gender: 'FEMALE' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (nextSkip: number, q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ take: String(PAGE), skip: String(nextSkip) });
      if (q) params.set('search', q);
      const data = await apiFetch<Paginated<StudentRow>>(`/students?${params.toString()}`);
      setRows(data.items);
      setTotal(data.total);
      setSkip(nextSkip);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) {
      router.replace('/login');
      return;
    }
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
    apiFetch<MeResponse>('/users/me').catch(() => {});
    apiFetch<ProgramRef[]>('/programs').then(setPrograms).catch(() => {});
    void load(0, '');
  }, [router, load]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => void load(0, search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch('/students', { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false);
      setForm({ studentCode: '', nameEn: '', nameTh: '', nickname: '', programId: '', gender: 'FEMALE' });
      await load(0, '');
      setSearch('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create student');
    } finally {
      setSaving(false);
    }
  }

  const page = Math.floor(skip / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, maxWidth: 1440, margin: '0 auto' }}>
      <Sidebar active="Students" />

      <div style={{ flex: 1, minWidth: 0 }}>
        <Topbar email={email} />

        <div className="rise" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('students.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>
              {total} {t('students.count')}
            </p>
          </div>
          <button className="btn-primary" style={{ padding: '11px 18px', fontSize: 14.5 }} onClick={() => setShowForm((s) => !s)}>
            {showForm ? t('students.close') : t('students.add')}
          </button>
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
            <button className="btn-primary" type="submit" disabled={saving} style={{ padding: '12px', fontSize: 14.5 }}>{saving ? t('students.saving') : t('students.create')}</button>
            {formError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{formError}</div>}
          </form>
        )}

        {/* Search */}
        <div className="glass hairline rise" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderRadius: 14, marginBottom: 16, color: 'var(--text-2)', maxWidth: 420 }}>
          <IconSearch />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('students.search')}
            style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-0)', fontSize: 14, width: '100%' }}
          />
        </div>

        <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
          {error && <div className="chip chip-danger" style={{ margin: 12 }}>{error}</div>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                  <Th>{t('students.studentId')}</Th><Th>{t('students.name')}</Th><Th>{t('students.nickname')}</Th><Th>{t('students.program')}</Th><Th>{t('students.year')}</Th><Th>{t('students.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('common.loading')}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 48, textAlign: 'center' }}>
                    <div className="brand-gradient floaty" style={{ width: 46, height: 46, borderRadius: 14, margin: '0 auto 12px', display: 'grid', placeItems: 'center' }}><IconStudents width={22} height={22} /></div>
                    <div style={{ fontWeight: 650 }}>{t('students.none')}</div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t('students.noneHint')}</div>
                  </td></tr>
                ) : rows.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                    <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{s.studentCode}</span></Td>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{s.nameEn}</div>
                      {s.nameTh && <div className="muted" style={{ fontSize: 12.5 }}>{s.nameTh}</div>}
                    </Td>
                    <Td>{s.nickname || <span className="muted">—</span>}</Td>
                    <Td><span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>{s.program.code}</span></Td>
                    <Td>{s.admissionYear ?? <span className="muted">—</span>}</Td>
                    <Td><StatusChip status={s.status} /></Td>
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
function StatusChip({ status }: { status: string }) {
  const cls = status === 'STUDYING' ? 'chip-success' : status === 'GRADUATED' ? 'chip' : 'chip-warning';
  return <span className={`chip ${cls}`} style={cls === 'chip' ? { background: 'var(--glass-hairline)', color: 'var(--text-1)' } : undefined}>{status.toLowerCase()}</span>;
}
