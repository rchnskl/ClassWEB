'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import StudentPicker, { type StudentHit } from '@/components/StudentPicker';
import { apiFetch, type MeResponse, type Paginated } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ProgramRef { id: string; code: string; nameEn: string }
interface GroupRow {
  id: string; scope: 'CENTRAL' | 'SECTION'; code: string | null;
  nameEn: string; nameTh: string | null; yearLevel: number | null; order: number;
  program: { id: string; code: string; nameEn: string } | null;
  section: { id: string; sectionNo: string; subject: { code: string; nameEn: string } } | null;
  _count: { members: number };
}
interface GroupMember {
  id: string; studentCode: string; nameEn: string; nameTh: string | null;
  yearLevel: number | null; status: string; program: { id: string; code: string };
}
interface GroupDetail extends GroupRow { members: GroupMember[] }

const YEARS = [1, 2, 3, 4];

export default function GroupsPage() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [programs, setPrograms] = useState<ProgramRef[]>([]);
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState('');

  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [busyMember, setBusyMember] = useState<string | null>(null);

  const [showSplit, setShowSplit] = useState(false);
  const [split, setSplit] = useState({ programId: '', yearLevel: '2', groupCount: '6', strategy: 'SEQUENTIAL', namePrefixTh: 'กลุ่ม', namePrefixEn: 'Group' });
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ take: '100', scope: 'CENTRAL' });
      if (yearFilter) params.set('yearLevel', yearFilter);
      const data = await apiFetch<Paginated<GroupRow>>(`/student-groups?${params.toString()}`);
      setRows(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, [yearFilter]);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
    apiFetch<MeResponse>('/users/me')
      .then((me) => setIsAdmin(me.roles.some((r) => r.role.code === 'ADMIN')))
      .catch(() => {});
    apiFetch<ProgramRef[]>('/programs')
      .then((p) => { setPrograms(p); setSplit((s) => ({ ...s, programId: p[0]?.id ?? '' })); })
      .catch(() => {});
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function openDetail(id: string) {
    try {
      setDetail(await apiFetch<GroupDetail>(`/student-groups/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open group');
    }
  }

  async function createGroup() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await apiFetch('/student-groups', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'CENTRAL', nameEn: newName.trim(), nameTh: newName.trim(),
          ...(yearFilter ? { yearLevel: Number(yearFilter) } : {}),
          ...(programs[0] ? { programId: programs[0].id } : {}),
        }),
      });
      setNewName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
    } finally { setCreating(false); }
  }

  async function runSplit() {
    setSplitting(true);
    setSplitError(null);
    try {
      await apiFetch('/student-groups/auto-split', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'CENTRAL',
          programId: split.programId,
          yearLevel: Number(split.yearLevel),
          groupCount: Number(split.groupCount),
          strategy: split.strategy,
          namePrefixEn: split.namePrefixEn,
          namePrefixTh: split.namePrefixTh,
        }),
      });
      setShowSplit(false);
      setYearFilter(split.yearLevel);
      await load();
    } catch (err) {
      setSplitError(err instanceof Error ? err.message : 'Auto-split failed');
    } finally { setSplitting(false); }
  }

  async function addMember(hit: StudentHit) {
    if (!detail) return;
    try {
      await apiFetch(`/student-groups/${detail.id}/members`, { method: 'POST', body: JSON.stringify({ studentIds: [hit.id] }) });
      await openDetail(detail.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    }
  }

  async function removeMember(studentId: string) {
    if (!detail) return;
    setBusyMember(studentId);
    try {
      await apiFetch(`/student-groups/${detail.id}/members/${studentId}`, { method: 'DELETE' });
      await openDetail(detail.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally { setBusyMember(null); }
  }

  async function deleteGroup(id: string) {
    if (!window.confirm(t('grp.confirmDelete'))) return;
    try {
      await apiFetch(`/student-groups/${id}`, { method: 'DELETE' });
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group');
    }
  }

  return (
    <div className="app-shell">
      <Sidebar active="Groups" />

      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('grp.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('grp.subtitle')}</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" style={{ padding: '11px 18px', fontSize: 14.5 }} onClick={() => setShowSplit((v) => !v)}>
              {showSplit ? t('students.close') : t('grp.autoSplit')}
            </button>
          )}
        </div>

        {showSplit && isAdmin && (
          <div className="glass rise" style={{ padding: 20, marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('grp.autoSplit')}</div>
            <p className="muted" style={{ fontSize: 12.5, margin: '0 0 14px' }}>{t('grp.autoSplitHint')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
              <Field label={t('students.program')}>
                <select className="input" value={split.programId} onChange={(e) => setSplit({ ...split, programId: e.target.value })}>
                  {programs.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                </select>
              </Field>
              <Field label={t('common.year')}>
                <select className="input" value={split.yearLevel} onChange={(e) => setSplit({ ...split, yearLevel: e.target.value })}>
                  {YEARS.map((y) => <option key={y} value={y}>{t('common.year')} {y}</option>)}
                </select>
              </Field>
              <Field label={t('grp.groupCount')}>
                <input className="input" type="number" min={2} max={50} value={split.groupCount} onChange={(e) => setSplit({ ...split, groupCount: e.target.value })} />
              </Field>
              <Field label={t('grp.strategy')}>
                <select className="input" value={split.strategy} onChange={(e) => setSplit({ ...split, strategy: e.target.value })}>
                  <option value="SEQUENTIAL">{t('grp.seq')}</option>
                  <option value="ROUND_ROBIN">{t('grp.rr')}</option>
                </select>
              </Field>
              <Field label={t('grp.prefix')}>
                <input className="input" value={split.namePrefixTh} onChange={(e) => setSplit({ ...split, namePrefixTh: e.target.value })} />
              </Field>
              <button className="btn-primary" disabled={splitting} onClick={runSplit} style={{ padding: 12, fontSize: 14 }}>
                {splitting ? t('students.saving') : t('grp.doSplit')}
              </button>
            </div>
            {splitError && <div className="chip chip-danger" role="alert" style={{ display: 'block', borderRadius: 11, padding: '9px 12px', marginTop: 12 }}>{splitError}</div>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <select className="input" style={{ maxWidth: 180 }} aria-label={t('grp.filterYear')} value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="">{t('grp.allYears')}</option>
            {YEARS.map((y) => <option key={y} value={y}>{t('common.year')} {y}</option>)}
          </select>
          {isAdmin && (
            <>
              <input className="input" style={{ maxWidth: 240 }} placeholder={t('grp.newName')} value={newName}
                onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void createGroup(); }} />
              <button className="glass hairline" disabled={!newName.trim() || creating} onClick={createGroup}
                style={{ padding: '10px 16px', borderRadius: 11, fontWeight: 650, fontSize: 13.5, color: 'var(--text-1)' }}>
                {creating ? '…' : t('grp.create')}
              </button>
            </>
          )}
        </div>

        {error && <div className="chip chip-danger" role="alert" style={{ display: 'block', borderRadius: 12, padding: '10px 13px', marginBottom: 14 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
          {loading ? (
            <div className="muted" style={{ padding: 30 }}>{t('common.loading')}</div>
          ) : rows.length === 0 ? (
            <div className="glass" style={{ padding: 40, textAlign: 'center', gridColumn: '1 / -1', borderRadius: 16 }}>
              <div style={{ fontWeight: 650 }}>{t('grp.none')}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t('grp.noneHint')}</div>
            </div>
          ) : rows.map((g) => (
            <div key={g.id} className="glass hairline" style={{ padding: 16, borderRadius: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(g.nameEn, g.nameTh)}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                    {g.program?.code ?? '—'}{g.yearLevel != null && ` · ${t('common.year')} ${g.yearLevel}`}
                  </div>
                </div>
                <span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>{g._count.members}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button onClick={() => openDetail(g.id)} className="glass hairline"
                  style={{ flex: 1, padding: '7px 10px', borderRadius: 10, fontSize: 12.5, fontWeight: 650, color: 'var(--text-1)' }}>
                  {t('grp.manage')}
                </button>
                {isAdmin && (
                  <button onClick={() => deleteGroup(g.id)} className="btn-danger" aria-label={t('grp.delete')} title={t('grp.delete')}
                    style={{ padding: '7px 11px', borderRadius: 10, fontSize: 12.5 }}>🗑</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {detail && (
        <div role="dialog" aria-modal="true" aria-label={detail.nameEn}
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,12,20,0.55)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', zIndex: 60, padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="glass" style={{ width: 'min(620px, 100%)', maxHeight: '86vh', overflow: 'auto', borderRadius: 18, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 720 }}>{name(detail.nameEn, detail.nameTh)}</h2>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                  {detail.members.length} {t('grp.members')}
                  {detail.yearLevel != null && ` · ${t('common.year')} ${detail.yearLevel}`}
                </p>
              </div>
              <button onClick={() => setDetail(null)} aria-label={t('common.close')} className="glass hairline icon-btn"
                style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: 'var(--text-1)' }}>✕</button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <StudentPicker onPick={addMember} yearLevel={detail.yearLevel ?? undefined} placeholder={t('grp.addMember')} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {detail.members.length === 0 ? (
                <div className="muted" style={{ textAlign: 'center', padding: 20, fontSize: 13 }}>{t('grp.noMembers')}</div>
              ) : detail.members.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--popover-hover)' }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: 12.5 }}>{m.studentCode}</span>
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(m.nameEn, m.nameTh)}</span>
                  <button onClick={() => removeMember(m.id)} disabled={busyMember === m.id} className="btn-danger"
                    aria-label={t('grp.removeMember')} title={t('grp.removeMember')} style={{ padding: '5px 11px', fontSize: 11.5 }}>
                    {busyMember === m.id ? '…' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="subtle" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
