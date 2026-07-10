'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { apiFetch, downloadFile } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Tab = 'general' | 'attendance' | 'users' | 'audit' | 'backup';

export default function SettingsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('admin@nursing.au.edu');
  const [tab, setTab] = useState<Tab>('general');

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
  }, [router]);

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
          <button className={`tab ${tab === 'attendance' ? 'active' : ''}`} onClick={() => setTab('attendance')}>{t('set.tab.attendance')}</button>
          <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>{t('users.tab')}</button>
          <button className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>{t('set.tab.audit')}</button>
          <button className={`tab ${tab === 'backup' ? 'active' : ''}`} onClick={() => setTab('backup')}>{t('set.tab.backup')}</button>
        </div>

        {tab === 'general' && <GeneralTab />}
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

  const load = useCallback(async () => {
    const data = await apiFetch<SettingRow[]>('/settings');
    const map: Record<string, string> = {};
    for (const r of data) map[r.key] = String(r.value ?? '');
    setRows(map);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function set(key: string, value: string) {
    setRows((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
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
    } finally { setSaving(false); }
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

  useEffect(() => { apiFetch<AttendanceRule>('/settings/attendance-rule').then(setRule).catch(() => {}); }, []);

  function set<K extends keyof AttendanceRule>(key: K, value: AttendanceRule[K]) {
    setRule((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function save() {
    if (!rule) return;
    setSaving(true);
    try {
      const { id, ...dto } = rule;
      void id;
      await apiFetch('/settings/attendance-rule', { method: 'PATCH', body: JSON.stringify(dto) });
      setSaved(true);
    } finally { setSaving(false); }
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

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', roleCode: 'LECTURER', linkType: 'none', linkId: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
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
    try {
      const res = await apiFetch<{ tempPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' });
      window.alert(`${t('users.tempPassword')}: ${res.tempPassword}`);
    } finally { setBusyId(null); }
  }

  async function toggleSuspend(u: UserRow) {
    const suspending = u.status !== 'SUSPENDED';
    if (suspending && !window.confirm(t('users.confirmSuspend'))) return;
    setBusyId(u.id);
    try {
      await apiFetch(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ status: suspending ? 'SUSPENDED' : 'ACTIVE' }) });
      await load();
    } finally { setBusyId(null); }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const linkOptions = form.linkType === 'lecturer' ? linkableLecturers : form.linkType === 'student' ? linkableStudents : [];

  return (
    <div>
      <div className="glass rise" style={{ padding: '16px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <p className="muted" style={{ fontSize: 13, margin: 0, maxWidth: 520 }}>{t('users.hint')}</p>
        <button className="btn-primary" onClick={openCreate} style={{ padding: '10px 18px', fontSize: 14, whiteSpace: 'nowrap' }}>{t('users.add')}</button>
      </div>

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

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ take: String(take), skip: String(skip) });
    if (action) qs.set('action', action);
    if (entityType) qs.set('entityType', entityType);
    const data = await apiFetch<{ total: number; items: AuditItem[] }>(`/audit?${qs}`);
    setItems(data.items);
    setTotal(data.total);
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

  const load = useCallback(async () => { setBackups(await apiFetch<Backup[]>('/backups')); }, []);
  useEffect(() => { void load(); }, [load]);

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtSize = (n: number | null) => (n == null ? '—' : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

  async function create() {
    setCreating(true);
    try { await apiFetch('/backups', { method: 'POST', body: JSON.stringify({}) }); await load(); }
    finally { setCreating(false); }
  }
  async function remove(id: string) {
    if (!window.confirm(t('set.backup.confirmDelete'))) return;
    setBusyId(id);
    try { await apiFetch(`/backups/${id}`, { method: 'DELETE' }); await load(); }
    finally { setBusyId(null); }
  }
  async function restore(id: string) {
    if (!window.confirm(t('set.backup.confirmRestore'))) return;
    setBusyId(id);
    try {
      const res = await apiFetch<{ totalRows: number }>(`/backups/${id}/restore`, { method: 'POST' });
      window.alert(`${res.totalRows} ${t('set.backup.restoredRows')}`);
    } finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="glass rise" style={{ padding: '16px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <p className="muted" style={{ fontSize: 13, margin: 0, maxWidth: 520 }}>{t('set.backup.hint')}</p>
        <button className="btn-primary" onClick={create} disabled={creating} style={{ padding: '10px 18px', fontSize: 14, whiteSpace: 'nowrap' }}>
          {creating ? t('set.backup.creating') : t('set.backup.create')}
        </button>
      </div>

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
