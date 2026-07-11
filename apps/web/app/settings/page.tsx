'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { apiFetch, downloadFile } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Tab = 'general' | 'academic' | 'attendance' | 'users' | 'audit' | 'backup';

export default function SettingsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('admin@nursing.au.edu');
  const [tab, setTab] = useState<Tab>('general');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    const u = localStorage.getItem('user');
    if (u) {
      try {
        const parsed = JSON.parse(u);
        setEmail(parsed.email);
        if (!(parsed.roleCodes ?? []).includes('ADMIN')) { router.replace('/dashboard'); return; }
      } catch {}
    }
    setChecked(true);
  }, [router]);

  if (!checked) return null;

  return (
    <div className="app-shell">
      <Sidebar active="Settings" />
      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('set.title')}</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('set.subtitle')}</p>
        </div>

        <div className="tabbar rise" style={{ marginBottom: 16 }}>
          <button className={`tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>{t('set.tab.general')}</button>
          <button className={`tab ${tab === 'academic' ? 'active' : ''}`} onClick={() => setTab('academic')}>{t('set.tab.academic')}</button>
          <button className={`tab ${tab === 'attendance' ? 'active' : ''}`} onClick={() => setTab('attendance')}>{t('set.tab.attendance')}</button>
          <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>{t('users.tab')}</button>
          <button className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>{t('set.tab.audit')}</button>
          <button className={`tab ${tab === 'backup' ? 'active' : ''}`} onClick={() => setTab('backup')}>{t('set.tab.backup')}</button>
        </div>

        {tab === 'general' && <GeneralTab />}
        {tab === 'academic' && <AcademicTab />}
        {tab === 'attendance' && <AttendanceTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'backup' && <BackupTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

interface SettingRow { key: string; value: unknown; description: string | null; updatedAt: string | null }

function GeneralTab() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await apiFetch<SettingRow[]>('/settings');
      const map: Record<string, string> = {};
      for (const r of data) map[r.key] = String(r.value ?? '');
      setRows(map);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load settings');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function set(key: string, value: string) {
    setRows((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          settings: [
            'system.name', 'theme.primaryColor', 'theme.secondaryColor', 'theme.mode', 'pdf.header', 'pdf.footer',
          ].map((key) => ({ key, value: rows[key] ?? '' })),
        }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally { setSaving(false); }
  }

  if (loadError) {
    return (
      <div className="glass rise" style={{ padding: 24 }}>
        <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{loadError}</div>
        <button onClick={load} className="glass hairline" style={{ padding: '9px 16px', borderRadius: 12, fontSize: 13.5, fontWeight: 600 }}>{t('common.retry')}</button>
      </div>
    );
  }

  return (
    <div className="glass rise" style={{ padding: 24, maxWidth: 620 }}>
      <Field label={t('set.general.systemName')}>
        <input className="input" value={rows['system.name'] ?? ''} onChange={(e) => set('system.name', e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label={t('set.general.primaryColor')}>
          <ColorField value={rows['theme.primaryColor'] ?? '#ff8a4c'} onChange={(v) => set('theme.primaryColor', v)} />
        </Field>
        <Field label={t('set.general.secondaryColor')}>
          <ColorField value={rows['theme.secondaryColor'] ?? '#6fa3d6'} onChange={(v) => set('theme.secondaryColor', v)} />
        </Field>
      </div>
      <Field label={t('set.general.themeMode')}>
        <select className="input" value={rows['theme.mode'] ?? 'system'} onChange={(e) => set('theme.mode', e.target.value)}>
          <option value="system">{t('set.mode.system')}</option>
          <option value="light">{t('set.mode.light')}</option>
          <option value="dark">{t('set.mode.dark')}</option>
        </select>
      </Field>
      <Field label={t('set.general.pdfHeader')}>
        <input className="input" value={rows['pdf.header'] ?? ''} onChange={(e) => set('pdf.header', e.target.value)} />
      </Field>
      <Field label={t('set.general.pdfFooter')}>
        <input className="input" value={rows['pdf.footer'] ?? ''} onChange={(e) => set('pdf.footer', e.target.value)} />
      </Field>
      <button className="btn-primary" onClick={save} disabled={saving} style={{ padding: '11px 22px', fontSize: 14.5, marginTop: 6 }}>
        {saving ? t('set.saving') : saved ? `✓ ${t('set.saved')}` : t('set.save')}
      </button>
      {error && <div className="chip chip-danger" style={{ display: 'block', marginTop: 12 }}>{error}</div>}
    </div>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ff8a4c'} onChange={(e) => onChange(e.target.value)}
        style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--glass-hairline)', background: 'transparent', cursor: 'pointer', padding: 2 }} />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13.5 }} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="muted" style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Academic years & semesters
// ---------------------------------------------------------------------------

interface YearRow { id: string; code: string; nameEn: string; nameTh: string | null; startDate: string; endDate: string; isCurrent: boolean; isActive: boolean }
interface SemesterRow {
  id: string; type: string; nameEn: string; nameTh: string | null; startDate: string; endDate: string;
  addDropDeadline: string | null; isCurrent: boolean; isActive: boolean; academicYear: { id: string; code: string };
}

const EMPTY_YEAR_FORM = { code: '', nameEn: '', nameTh: '', startDate: '', endDate: '' };
const EMPTY_SEMESTER_FORM = { academicYearId: '', type: 'FIRST', nameEn: '', nameTh: '', startDate: '', endDate: '', addDropDeadline: '' };

function AcademicTab() {
  const { t } = useI18n();
  const [years, setYears] = useState<YearRow[]>([]);
  const [semesters, setSemesters] = useState<SemesterRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showYearForm, setShowYearForm] = useState(false);
  const [yearForm, setYearForm] = useState(EMPTY_YEAR_FORM);
  const [savingYear, setSavingYear] = useState(false);

  const [showSemForm, setShowSemForm] = useState(false);
  const [semForm, setSemForm] = useState(EMPTY_SEMESTER_FORM);
  const [savingSem, setSavingSem] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [y, s] = await Promise.all([apiFetch<YearRow[]>('/academic-years'), apiFetch<SemesterRow[]>('/semesters')]);
      setYears(y);
      setSemesters(s);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load academic years/semesters');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submitYear(e: React.FormEvent) {
    e.preventDefault();
    setSavingYear(true);
    setActionError(null);
    try {
      await apiFetch('/academic-years', {
        method: 'POST',
        body: JSON.stringify({ ...yearForm, nameTh: yearForm.nameTh || undefined }),
      });
      setShowYearForm(false);
      setYearForm(EMPTY_YEAR_FORM);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create academic year');
    } finally { setSavingYear(false); }
  }

  async function setCurrentYear(id: string) {
    setBusyId(id);
    setActionError(null);
    try { await apiFetch(`/academic-years/${id}`, { method: 'PATCH', body: JSON.stringify({ isCurrent: true }) }); await load(); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusyId(null); }
  }

  async function submitSemester(e: React.FormEvent) {
    e.preventDefault();
    setSavingSem(true);
    setActionError(null);
    try {
      await apiFetch('/semesters', {
        method: 'POST',
        body: JSON.stringify({ ...semForm, nameTh: semForm.nameTh || undefined, addDropDeadline: semForm.addDropDeadline || undefined }),
      });
      setShowSemForm(false);
      setSemForm(EMPTY_SEMESTER_FORM);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create semester');
    } finally { setSavingSem(false); }
  }

  async function setCurrentSemester(id: string) {
    setBusyId(id);
    setActionError(null);
    try { await apiFetch(`/semesters/${id}`, { method: 'PATCH', body: JSON.stringify({ isCurrent: true }) }); await load(); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusyId(null); }
  }

  if (loadError) {
    return (
      <div className="glass rise" style={{ padding: 24 }}>
        <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{loadError}</div>
        <button onClick={load} className="glass hairline" style={{ padding: '9px 16px', borderRadius: 12, fontSize: 13.5, fontWeight: 600 }}>{t('common.retry')}</button>
      </div>
    );
  }

  return (
    <div>
      {actionError && <div className="chip chip-danger rise" style={{ display: 'block', marginBottom: 14, padding: '9px 12px' }}>{actionError}</div>}

      <div className="glass rise" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5 }}>{t('set.academic.years')}</div>
          <button className="btn-primary" onClick={() => setShowYearForm((v) => !v)} style={{ padding: '8px 16px', fontSize: 13.5 }}>
            {showYearForm ? t('subj.close') : t('set.academic.addYear')}
          </button>
        </div>

        {showYearForm && (
          <form onSubmit={submitYear} className="glass hairline" style={{ padding: 16, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
            <Field label={`${t('set.academic.code')} *`}><input className="input" required value={yearForm.code} onChange={(e) => setYearForm({ ...yearForm, code: e.target.value })} placeholder="2026" /></Field>
            <Field label={`${t('subj.nameEn')} *`}><input className="input" required value={yearForm.nameEn} onChange={(e) => setYearForm({ ...yearForm, nameEn: e.target.value })} placeholder="Academic Year 2026" /></Field>
            <Field label={t('subj.nameTh')}><input className="input" value={yearForm.nameTh} onChange={(e) => setYearForm({ ...yearForm, nameTh: e.target.value })} /></Field>
            <Field label={`${t('set.academic.startDate')} *`}><input type="date" className="input" required value={yearForm.startDate} onChange={(e) => setYearForm({ ...yearForm, startDate: e.target.value })} /></Field>
            <Field label={`${t('set.academic.endDate')} *`}><input type="date" className="input" required value={yearForm.endDate} onChange={(e) => setYearForm({ ...yearForm, endDate: e.target.value })} /></Field>
            <button className="btn-primary" type="submit" disabled={savingYear} style={{ padding: 11, fontSize: 14 }}>{savingYear ? t('subj.saving') : t('subj.create')}</button>
          </form>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--text-2)' }}><Th>{t('set.academic.code')}</Th><Th>{t('subj.nameEn')}</Th><Th> </Th></tr></thead>
          <tbody>
            {years.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center' }} className="muted">{t('set.academic.noYears')}</td></tr>
            ) : years.map((y) => (
              <tr key={y.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{y.code}</span></Td>
                <Td>{y.nameEn}</Td>
                <Td>
                  {y.isCurrent ? (
                    <span className="chip" style={{ background: 'var(--success)22', color: 'var(--success)', fontWeight: 700 }}>✓ {t('set.academic.current')}</span>
                  ) : (
                    <button onClick={() => setCurrentYear(y.id)} disabled={busyId === y.id} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
                      {busyId === y.id ? '…' : t('set.academic.setCurrent')}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="glass rise" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5 }}>{t('set.academic.semesters')}</div>
          <button className="btn-primary" onClick={() => setShowSemForm((v) => !v)} disabled={years.length === 0} style={{ padding: '8px 16px', fontSize: 13.5 }}>
            {showSemForm ? t('subj.close') : t('set.academic.addSemester')}
          </button>
        </div>
        {years.length === 0 && <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{t('set.academic.needYearFirst')}</div>}

        {showSemForm && (
          <form onSubmit={submitSemester} className="glass hairline" style={{ padding: 16, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
            <Field label={`${t('set.academic.year')} *`}>
              <select className="input" required value={semForm.academicYearId} onChange={(e) => setSemForm({ ...semForm, academicYearId: e.target.value })}>
                <option value="" disabled>{t('subj.select')}</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
              </select>
            </Field>
            <Field label={`${t('set.academic.type')} *`}>
              <select className="input" required value={semForm.type} onChange={(e) => setSemForm({ ...semForm, type: e.target.value })}>
                <option value="FIRST">{t('set.academic.first')}</option>
                <option value="SECOND">{t('set.academic.second')}</option>
                <option value="SUMMER">{t('set.academic.summer')}</option>
                <option value="SPECIAL">{t('set.academic.special')}</option>
              </select>
            </Field>
            <Field label={`${t('subj.nameEn')} *`}><input className="input" required value={semForm.nameEn} onChange={(e) => setSemForm({ ...semForm, nameEn: e.target.value })} placeholder="First Semester" /></Field>
            <Field label={t('subj.nameTh')}><input className="input" value={semForm.nameTh} onChange={(e) => setSemForm({ ...semForm, nameTh: e.target.value })} /></Field>
            <Field label={`${t('set.academic.startDate')} *`}><input type="date" className="input" required value={semForm.startDate} onChange={(e) => setSemForm({ ...semForm, startDate: e.target.value })} /></Field>
            <Field label={`${t('set.academic.endDate')} *`}><input type="date" className="input" required value={semForm.endDate} onChange={(e) => setSemForm({ ...semForm, endDate: e.target.value })} /></Field>
            <Field label={t('set.academic.addDropDeadline')}><input type="date" className="input" value={semForm.addDropDeadline} onChange={(e) => setSemForm({ ...semForm, addDropDeadline: e.target.value })} /></Field>
            <button className="btn-primary" type="submit" disabled={savingSem} style={{ padding: 11, fontSize: 14 }}>{savingSem ? t('subj.saving') : t('subj.create')}</button>
          </form>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--text-2)' }}><Th>{t('set.academic.year')}</Th><Th>{t('set.academic.type')}</Th><Th>{t('subj.nameEn')}</Th><Th> </Th></tr></thead>
          <tbody>
            {semesters.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center' }} className="muted">{t('set.academic.noSemesters')}</td></tr>
            ) : semesters.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{s.academicYear.code}</span></Td>
                <Td>{s.type}</Td>
                <Td>{s.nameEn}</Td>
                <Td>
                  {s.isCurrent ? (
                    <span className="chip" style={{ background: 'var(--success)22', color: 'var(--success)', fontWeight: 700 }}>✓ {t('set.academic.current')}</span>
                  ) : (
                    <button onClick={() => setCurrentSemester(s.id)} disabled={busyId === s.id} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
                      {busyId === s.id ? '…' : t('set.academic.setCurrent')}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance rules
// ---------------------------------------------------------------------------

interface AttendanceRule {
  id: string;
  lateAfterMinutes: number;
  autoAbsentAfterMinutes: number;
  lockAfterMinutes: number;
  countWeekend: boolean;
  countHoliday: boolean;
  warningThreshold: number;
  riskThreshold: number;
  criticalThreshold: number;
}

function AttendanceTab() {
  const { t } = useI18n();
  const [rule, setRule] = useState<AttendanceRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    apiFetch<AttendanceRule>('/settings/attendance-rule').then(setRule)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load'));
  }, []);
  useEffect(() => { load(); }, [load]);

  function set<K extends keyof AttendanceRule>(key: K, value: AttendanceRule[K]) {
    setRule((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function save() {
    if (!rule) return;
    setSaving(true);
    setError(null);
    try {
      const { id, ...dto } = rule;
      void id;
      await apiFetch('/settings/attendance-rule', { method: 'PATCH', body: JSON.stringify(dto) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save attendance rule');
    } finally { setSaving(false); }
  }

  if (loadError) {
    return (
      <div className="glass rise" style={{ padding: 24 }}>
        <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{loadError}</div>
        <button onClick={load} className="glass hairline" style={{ padding: '9px 16px', borderRadius: 12, fontSize: 13.5, fontWeight: 600 }}>{t('common.retry')}</button>
      </div>
    );
  }
  if (!rule) return <div className="glass rise muted" style={{ padding: 24 }}>{t('common.loading')}</div>;

  return (
    <div className="glass rise" style={{ padding: 24, maxWidth: 620 }}>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 18px' }}>{t('set.att.hint')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label={t('set.att.lateAfter')}>
          <input type="number" min={0} className="input" value={rule.lateAfterMinutes} onChange={(e) => set('lateAfterMinutes', Number(e.target.value))} />
        </Field>
        <Field label={t('set.att.autoAbsentAfter')}>
          <input type="number" min={0} className="input" value={rule.autoAbsentAfterMinutes} onChange={(e) => set('autoAbsentAfterMinutes', Number(e.target.value))} />
        </Field>
        <Field label={t('set.att.lockAfter')}>
          <input type="number" min={0} className="input" value={rule.lockAfterMinutes} onChange={(e) => set('lockAfterMinutes', Number(e.target.value))} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 20, margin: '4px 0 18px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={rule.countWeekend} onChange={(e) => set('countWeekend', e.target.checked)} style={{ width: 17, height: 17 }} />
          {t('set.att.countWeekend')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={rule.countHoliday} onChange={(e) => set('countHoliday', e.target.checked)} style={{ width: 17, height: 17 }} />
          {t('set.att.countHoliday')}
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <Field label={t('set.att.warningThreshold')}>
          <input type="number" min={0} max={100} className="input" value={rule.warningThreshold} onChange={(e) => set('warningThreshold', Number(e.target.value))} />
        </Field>
        <Field label={t('set.att.riskThreshold')}>
          <input type="number" min={0} max={100} className="input" value={rule.riskThreshold} onChange={(e) => set('riskThreshold', Number(e.target.value))} />
        </Field>
        <Field label={t('set.att.criticalThreshold')}>
          <input type="number" min={0} max={100} className="input" value={rule.criticalThreshold} onChange={(e) => set('criticalThreshold', Number(e.target.value))} />
        </Field>
      </div>
      <button className="btn-primary" onClick={save} disabled={saving} style={{ padding: '11px 22px', fontSize: 14.5, marginTop: 6 }}>
        {saving ? t('set.saving') : saved ? `✓ ${t('set.saved')}` : t('set.save')}
      </button>
      {error && <div className="chip chip-danger" style={{ display: 'block', marginTop: 12 }}>{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User accounts
// ---------------------------------------------------------------------------

interface UserRow {
  id: string; email: string; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; lastLoginAt: string | null;
  roles: { role: { code: string; nameEn: string; nameTh: string | null } }[];
  lecturer: { nameEn: string; nameTh: string | null; employeeCode: string } | null;
  student: { nameEn: string; nameTh: string | null; studentCode: string } | null;
}
interface RoleRef { code: string; nameEn: string; nameTh: string | null }
interface LinkableRef { id: string; nameEn: string; nameTh: string | null; employeeCode?: string; studentCode?: string }

function UsersTab() {
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [linkableLecturers, setLinkableLecturers] = useState<LinkableRef[]>([]);
  const [linkableStudents, setLinkableStudents] = useState<LinkableRef[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', roleCode: 'LECTURER', linkType: 'none', linkId: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [u, r, ll, ls] = await Promise.all([
        apiFetch<{ items: UserRow[] }>('/users'),
        apiFetch<RoleRef[]>('/users/roles'),
        apiFetch<LinkableRef[]>('/users/linkable-lecturers'),
        apiFetch<LinkableRef[]>('/users/linkable-students'),
      ]);
      setUsers(u.items);
      setRoles(r);
      setLinkableLecturers(ll);
      setLinkableStudents(ls);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load users');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setForm({ email: '', roleCode: roles[0]?.code ?? 'LECTURER', linkType: 'none', linkId: '' });
    setCreateError(null);
    setCreatedResult(null);
    setCopied(false);
    setShowCreate(true);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const body: Record<string, string> = { email: form.email, roleCode: form.roleCode };
      if (form.linkType === 'lecturer' && form.linkId) body.lecturerId = form.linkId;
      if (form.linkType === 'student' && form.linkId) body.studentId = form.linkId;
      const res = await apiFetch<{ email: string; tempPassword: string }>('/users', { method: 'POST', body: JSON.stringify(body) });
      setCreatedResult(res);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally { setCreating(false); }
  }

  async function copyPassword() {
    if (!createdResult) return;
    try { await navigator.clipboard.writeText(createdResult.tempPassword); setCopied(true); } catch { /* ignore */ }
  }

  async function resetPassword(u: UserRow) {
    if (!window.confirm(t('users.confirmReset'))) return;
    setBusyId(u.id);
    setActionError(null);
    try {
      const res = await apiFetch<{ tempPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' });
      window.alert(`${t('users.tempPassword')}: ${res.tempPassword}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally { setBusyId(null); }
  }

  async function toggleSuspend(u: UserRow) {
    const suspending = u.status !== 'SUSPENDED';
    if (suspending && !window.confirm(t('users.confirmSuspend'))) return;
    setBusyId(u.id);
    setActionError(null);
    try {
      await apiFetch(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ status: suspending ? 'SUSPENDED' : 'ACTIVE' }) });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update user');
    } finally { setBusyId(null); }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const linkOptions = form.linkType === 'lecturer' ? linkableLecturers : form.linkType === 'student' ? linkableStudents : [];

  if (loadError) {
    return (
      <div className="glass rise" style={{ padding: 24 }}>
        <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{loadError}</div>
        <button onClick={load} className="glass hairline" style={{ padding: '9px 16px', borderRadius: 12, fontSize: 13.5, fontWeight: 600 }}>{t('common.retry')}</button>
      </div>
    );
  }

  return (
    <div>
      <div className="glass rise" style={{ padding: '16px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <p className="muted" style={{ fontSize: 13, margin: 0, maxWidth: 520 }}>{t('users.hint')}</p>
        <button className="btn-primary" onClick={openCreate} style={{ padding: '10px 18px', fontSize: 14, whiteSpace: 'nowrap' }}>{t('users.add')}</button>
      </div>

      {actionError && <div className="chip chip-danger" style={{ display: 'block', marginBottom: 16 }}>{actionError}</div>}

      <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <Th>{t('users.email')}</Th><Th>{t('users.name')}</Th><Th>{t('users.role')}</Th><Th>{t('users.status')}</Th><Th>{t('users.lastLogin')}</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('users.none')}</td></tr>
              ) : users.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                  <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{u.email}</span></Td>
                  <Td>
                    {u.lecturer ? <span>{name(u.lecturer.nameEn, u.lecturer.nameTh)} <span className="muted" style={{ fontSize: 12 }}>({u.lecturer.employeeCode})</span></span>
                      : u.student ? <span>{name(u.student.nameEn, u.student.nameTh)} <span className="muted" style={{ fontSize: 12 }}>({u.student.studentCode})</span></span>
                      : <span className="muted">{t('users.unlinked')}</span>}
                  </Td>
                  <Td>{u.roles.map((r) => name(r.role.nameEn, r.role.nameTh)).join(', ') || '—'}</Td>
                  <Td><span className={`chip ${u.status === 'ACTIVE' ? 'chip-success' : u.status === 'SUSPENDED' ? 'chip-danger' : 'chip-warning'}`}>{t(`users.status.${u.status}`)}</span></Td>
                  <Td><span className="muted" style={{ fontSize: 12.5 }}>{u.lastLoginAt ? fmt(u.lastLoginAt) : t('users.never')}</span></Td>
                  <Td>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button onClick={() => resetPassword(u)} disabled={busyId === u.id} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
                        {busyId === u.id ? '…' : t('users.resetPassword')}
                      </button>
                      <button onClick={() => toggleSuspend(u)} disabled={busyId === u.id} className={u.status === 'SUSPENDED' ? 'glass hairline' : 'btn-danger'} style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
                        {busyId === u.id ? '…' : u.status === 'SUSPENDED' ? t('users.reactivate') : t('users.suspend')}
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div onClick={() => setShowCreate(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(6,10,20,0.5)', backdropFilter: 'blur(3px)', zIndex: 1200, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: 'min(440px, 100%)', maxHeight: '86vh', overflowY: 'auto', background: 'var(--popover-bg)', border: '1px solid var(--glass-hairline)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{createdResult ? t('users.createdTitle') : t('users.add')}</h2>
              <button onClick={() => setShowCreate(false)} className="glass hairline icon-btn" style={{ width: 32, height: 32, fontSize: 17 }}>×</button>
            </div>

            {createdResult ? (
              <div>
                <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>{t('users.createdHint')}</p>
                <div style={{ marginBottom: 4 }}>
                  <span className="subtle" style={{ fontSize: 12.5, fontWeight: 600 }}>{createdResult.email}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                  <code style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: 'var(--popover-hover)', fontSize: 15, fontWeight: 700, letterSpacing: 0.5 }}>{createdResult.tempPassword}</code>
                  <button onClick={copyPassword} className="glass hairline" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>{copied ? `✓ ${t('users.copied')}` : t('users.copy')}</button>
                </div>
                <button onClick={() => setShowCreate(false)} className="btn-primary" style={{ width: '100%', padding: 12, fontSize: 14.5 }}>{t('users.done')}</button>
              </div>
            ) : (
              <form onSubmit={submitCreate}>
                <Field label={`${t('users.email')} *`}>
                  <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field label={t('users.role')}>
                  <select className="input" value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
                    {roles.map((r) => <option key={r.code} value={r.code}>{name(r.nameEn, r.nameTh)}</option>)}
                  </select>
                </Field>
                <Field label={t('users.linkTo')}>
                  <select className="input" value={form.linkType} onChange={(e) => setForm({ ...form, linkType: e.target.value, linkId: '' })}>
                    <option value="none">{t('users.linkNone')}</option>
                    <option value="lecturer">{t('users.linkLecturer')}</option>
                    <option value="student">{t('users.linkStudent')}</option>
                  </select>
                </Field>
                {form.linkType !== 'none' && (
                  <Field label=" ">
                    <select className="input" required value={form.linkId} onChange={(e) => setForm({ ...form, linkId: e.target.value })}>
                      <option value="" disabled>—</option>
                      {linkOptions.map((o) => <option key={o.id} value={o.id}>{name(o.nameEn, o.nameTh)} ({o.employeeCode ?? o.studentCode})</option>)}
                    </select>
                  </Field>
                )}
                {createError && <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{createError}</div>}
                <button type="submit" disabled={creating} className="btn-primary" style={{ width: '100%', padding: 12, fontSize: 14.5, marginTop: 4 }}>
                  {creating ? t('users.creating') : t('users.create')}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

interface AuditItem {
  id: string; action: string; entityType: string | null; entityId: string | null;
  ipAddress: string | null; createdAt: string; user: { email: string } | null;
}
interface AuditFacets { actions: string[]; entityTypes: string[] }

const ACTION_COLOR: Record<string, string> = {
  CREATE: 'chip-success', UPDATE: 'chip-warning', DELETE: 'chip-danger', LOGIN: 'chip-success', LOGOUT: 'chip-warning',
};

function AuditTab() {
  const { t, lang } = useI18n();
  const [facets, setFacets] = useState<AuditFacets>({ actions: [], entityTypes: [] });
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [skip, setSkip] = useState(0);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const take = 50;

  useEffect(() => { apiFetch<AuditFacets>('/audit/facets').then(setFacets).catch(() => {}); }, []);

  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const qs = new URLSearchParams({ take: String(take), skip: String(skip) });
      if (action) qs.set('action', action);
      if (entityType) qs.set('entityType', entityType);
      const data = await apiFetch<{ total: number; items: AuditItem[] }>(`/audit?${qs}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load audit log');
    }
  }, [action, entityType, skip]);

  useEffect(() => { void load(); }, [load]);

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div>
      <div className="rise" style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 'auto', minWidth: 160 }} value={action} onChange={(e) => { setAction(e.target.value); setSkip(0); }}>
          <option value="">{t('set.audit.allActions')}</option>
          {facets.actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input" style={{ width: 'auto', minWidth: 160 }} value={entityType} onChange={(e) => { setEntityType(e.target.value); setSkip(0); }}>
          <option value="">{t('set.audit.allEntities')}</option>
          {facets.entityTypes.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5 }}>{total} {t('set.audit.total')}</span>
      </div>

      {loadError && (
        <div className="glass rise" style={{ padding: 20, marginBottom: 14 }}>
          <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{loadError}</div>
          <button onClick={load} className="glass hairline" style={{ padding: '9px 16px', borderRadius: 12, fontSize: 13.5, fontWeight: 600 }}>{t('common.retry')}</button>
        </div>
      )}

      <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <Th>{t('set.audit.time')}</Th><Th>{t('set.audit.action')}</Th><Th>{t('set.audit.entity')}</Th><Th>{t('set.audit.user')}</Th><Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('set.audit.noResults')}</td></tr>
              ) : items.map((it) => (
                <tr key={it.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                  <Td><span className="muted" style={{ fontSize: 12.5 }}>{fmt(it.createdAt)}</span></Td>
                  <Td><span className={`chip ${ACTION_COLOR[it.action] ?? ''}`}>{it.action}</span></Td>
                  <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{it.entityType ?? '—'}</span></Td>
                  <Td>{it.user?.email ?? '—'}</Td>
                  <Td><span className="muted" style={{ fontSize: 12.5 }}>{it.ipAddress ?? '—'}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {total > take && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center', marginTop: 14 }}>
          <button className="glass hairline" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - take))} style={{ padding: '7px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.previous')}</button>
          <span className="muted" style={{ fontSize: 13 }}>{t('common.page')} {Math.floor(skip / take) + 1} {t('common.of')} {Math.ceil(total / take)}</span>
          <button className="glass hairline" disabled={skip + take >= total} onClick={() => setSkip(skip + take)} style={{ padding: '7px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.next')}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backup & restore
// ---------------------------------------------------------------------------

interface Backup {
  id: string; status: string; type: string; fileName: string | null; sizeBytes: number | null;
  createdAt: string; completedAt: string | null; error: string | null;
  metadata: { note?: string; rowCount?: number } | null;
}

function BackupTab() {
  const { t, lang } = useI18n();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try { setBackups(await apiFetch<Backup[]>('/backups')); }
    catch (err) { setLoadError(err instanceof Error ? err.message : 'Failed to load backups'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtSize = (n: number | null) => (n == null ? '—' : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

  async function create() {
    setCreating(true);
    setActionError(null);
    try { await apiFetch('/backups', { method: 'POST', body: JSON.stringify({}) }); await load(); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to create backup'); }
    finally { setCreating(false); }
  }
  async function remove(id: string) {
    if (!window.confirm(t('set.backup.confirmDelete'))) return;
    setBusyId(id);
    setActionError(null);
    try { await apiFetch(`/backups/${id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to delete backup'); }
    finally { setBusyId(null); }
  }
  async function restore(id: string) {
    if (!window.confirm(t('set.backup.confirmRestore'))) return;
    setBusyId(id);
    setActionError(null);
    try {
      const res = await apiFetch<{ totalRows: number }>(`/backups/${id}/restore`, { method: 'POST' });
      window.alert(`${res.totalRows} ${t('set.backup.restoredRows')}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to restore backup');
    } finally { setBusyId(null); }
  }

  if (loadError) {
    return (
      <div className="glass rise" style={{ padding: 24 }}>
        <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{loadError}</div>
        <button onClick={load} className="glass hairline" style={{ padding: '9px 16px', borderRadius: 12, fontSize: 13.5, fontWeight: 600 }}>{t('common.retry')}</button>
      </div>
    );
  }

  return (
    <div>
      <div className="glass rise" style={{ padding: '16px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <p className="muted" style={{ fontSize: 13, margin: 0, maxWidth: 520 }}>{t('set.backup.hint')}</p>
        <button className="btn-primary" onClick={create} disabled={creating} style={{ padding: '10px 18px', fontSize: 14, whiteSpace: 'nowrap' }}>
          {creating ? t('set.backup.creating') : t('set.backup.create')}
        </button>
      </div>

      {actionError && <div className="chip chip-danger" style={{ display: 'block', marginBottom: 16 }}>{actionError}</div>}

      <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <Th>{lang === 'th' ? 'วันที่สร้าง' : 'Created'}</Th>
                <Th>{lang === 'th' ? 'สถานะ' : 'Status'}</Th>
                <Th>{lang === 'th' ? 'ขนาด' : 'Size'}</Th>
                <Th>{t('set.backup.rows')}</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {backups.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('set.backup.noBackups')}</td></tr>
              ) : backups.map((b) => (
                <tr key={b.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                  <Td>
                    <div>{fmt(b.createdAt)}</div>
                    {b.metadata?.note && <div className="muted" style={{ fontSize: 12 }}>{b.metadata.note}</div>}
                  </Td>
                  <Td>
                    <span className={`chip ${b.status === 'COMPLETED' ? 'chip-success' : b.status === 'FAILED' ? 'chip-danger' : 'chip-warning'}`}>
                      {t(`set.backup.status.${b.status}`)}
                    </span>
                  </Td>
                  <Td><span className="muted">{fmtSize(b.sizeBytes)}</span></Td>
                  <Td><span className="muted">{b.metadata?.rowCount ?? '—'}</span></Td>
                  <Td>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button disabled={b.status !== 'COMPLETED' || busyId === b.id}
                        onClick={() => downloadFile(`/backups/${b.id}/download`, b.fileName ?? 'backup.json.gz')}
                        className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                        {t('set.backup.download')}
                      </button>
                      <button disabled={b.status !== 'COMPLETED' || busyId === b.id}
                        onClick={() => restore(b.id)}
                        className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                        {busyId === b.id ? t('set.backup.restoring') : t('set.backup.restore')}
                      </button>
                      <button disabled={busyId === b.id} onClick={() => remove(b.id)} className="btn-danger" style={{ padding: '6px 12px', fontSize: 12.5 }}>
                        {t('set.backup.delete')}
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
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '12px 14px', fontWeight: 600, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '12px 14px' }}>{children}</td>;
}
