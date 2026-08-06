'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, type Paginated } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import StudentPicker, { type StudentHit } from './StudentPicker';

interface SectionDetail {
  id: string; sectionNo: string; capacity: number; currentEnrollment: number; isActive: boolean;
  subject: { id: string; code: string; nameEn: string; credits: number };
  semester: { id: string; nameEn: string; academicYear: { code: string } };
  lecturer: { id: string; nameEn: string; employeeCode: string; userId: string | null } | null;
  room: { id: string; roomNumber: string } | null;
  _count: { enrollments: number };
}
interface RoomRef { id: string; roomNumber: string }
interface LecturerRef { id: string; nameEn: string; employeeCode: string }
interface EnrollmentRow { id: string; status: string; student: { id: string; studentCode: string; nameEn: string; nameTh?: string | null } }
interface GroupRef { id: string; nameEn: string; nameTh: string | null; yearLevel: number | null; _count: { members: number } }
interface RubricConfigRow { rubricId: string; code: string; nameEn: string; nameTh: string | null; weightPercent: number; isActive: boolean }

export default function SectionDetailDrawer({
  sectionId, isAdmin, onClose, onChanged,
}: {
  sectionId: string; isAdmin: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [section, setSection] = useState<SectionDetail | null>(null);
  const [rooms, setRooms] = useState<RoomRef[]>([]);
  const [lecturers, setLecturers] = useState<LecturerRef[]>([]);
  const [form, setForm] = useState({ sectionNo: '', capacity: 40, roomId: '', lecturerId: '' });
  const [savingInfo, setSavingInfo] = useState(false);

  const [roster, setRoster] = useState<EnrollmentRow[]>([]);
  const [addingStudent, setAddingStudent] = useState(false);
  const [busyEnrollmentId, setBusyEnrollmentId] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [groups, setGroups] = useState<GroupRef[]>([]);
  const [addGroupId, setAddGroupId] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupResult, setGroupResult] = useState<{ enrolled: number; skipped: { studentCode: string; reason: string }[] } | null>(null);

  const [rubricConfig, setRubricConfig] = useState<RubricConfigRow[] | null>(null);
  const [savingRubrics, setSavingRubrics] = useState(false);

  const loadSection = useCallback(async () => {
    const s = await apiFetch<SectionDetail>(`/sections/${sectionId}`);
    setSection(s);
    setForm({ sectionNo: s.sectionNo, capacity: s.capacity, roomId: s.room?.id ?? '', lecturerId: s.lecturer?.id ?? '' });
    return s;
  }, [sectionId]);

  const loadRoster = useCallback(async () => {
    const r = await apiFetch<Paginated<EnrollmentRow>>(`/enrollments?sectionId=${sectionId}&take=200`);
    setRoster(r.items.filter((e) => e.status === 'ENROLLED'));
  }, [sectionId]);

  useEffect(() => {
    (async () => {
      const s = await loadSection();
      await loadRoster();
      apiFetch<RoomRef[] | Paginated<RoomRef>>('/rooms?take=200').then((d) => setRooms(Array.isArray(d) ? d : d.items)).catch(() => {});
      if (isAdmin) apiFetch<Paginated<LecturerRef>>('/lecturers?take=200').then((d) => setLecturers(d.items)).catch(() => {});
      apiFetch<Paginated<GroupRef>>('/student-groups?take=100').then((d) => setGroups(d.items)).catch(() => {});
      apiFetch<RubricConfigRow[]>(`/assessment/subjects/${s.subject.id}/rubric-config`).then(setRubricConfig).catch(() => {});
    })();
  }, [loadSection, loadRoster, isAdmin]);

  async function saveInfo() {
    setSavingInfo(true);
    try {
      await apiFetch(`/sections/${sectionId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sectionNo: form.sectionNo,
          capacity: form.capacity,
          roomId: form.roomId || undefined,
          ...(isAdmin ? { lecturerId: form.lecturerId || undefined } : {}),
        }),
      });
      await loadSection();
      onChanged();
    } finally { setSavingInfo(false); }
  }

  async function addStudent(hit: StudentHit) {
    setAddingStudent(true);
    setRosterError(null);
    try {
      await apiFetch('/enrollments', { method: 'POST', body: JSON.stringify({ sectionId, studentId: hit.id }) });
      await loadRoster();
      await loadSection();
      onChanged();
    } catch (err) {
      // Surfaces the real reason (capacity, already in another section of this
      // subject, not currently studying) instead of failing silently.
      setRosterError(err instanceof Error ? err.message : t('secD.addFailed'));
    } finally { setAddingStudent(false); }
  }

  async function addGroup() {
    if (!addGroupId) return;
    setAddingGroup(true);
    setRosterError(null);
    setGroupResult(null);
    try {
      const res = await apiFetch<{ enrolled: number; skipped: { studentCode: string; reason: string }[] }>(
        `/student-groups/${addGroupId}/enroll`,
        { method: 'POST', body: JSON.stringify({ sectionId }) },
      );
      setGroupResult(res);
      await loadRoster();
      await loadSection();
      onChanged();
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : t('secD.addFailed'));
    } finally { setAddingGroup(false); }
  }

  async function dropStudent(enrollmentId: string) {
    if (!window.confirm(t('secD.confirmDrop'))) return;
    setBusyEnrollmentId(enrollmentId);
    setRosterError(null);
    try {
      await apiFetch(`/enrollments/${enrollmentId}/drop`, { method: 'PATCH', body: JSON.stringify({}) });
      await loadRoster();
      await loadSection();
      onChanged();
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : t('secD.dropFailed'));
    } finally { setBusyEnrollmentId(null); }
  }

  const activeSum = rubricConfig ? rubricConfig.filter((r) => r.isActive).reduce((a, r) => a + r.weightPercent, 0) : 0;
  async function saveRubrics() {
    if (!rubricConfig || !section) return;
    setSavingRubrics(true);
    try {
      await apiFetch(`/assessment/subjects/${section.subject.id}/rubric-config`, {
        method: 'PATCH',
        body: JSON.stringify({ rubrics: rubricConfig.map((r) => ({ rubricId: r.rubricId, weightPercent: r.weightPercent, isActive: r.isActive })) }),
      });
    } finally { setSavingRubrics(false); }
  }

  if (!section) return null;
  const isFull = section.currentEnrollment >= section.capacity;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(6,10,20,0.5)', backdropFilter: 'blur(3px)', zIndex: 1150, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: 'min(640px, 100%)', height: '100%', background: 'var(--popover-bg)', borderLeft: '1px solid var(--glass-hairline)', boxShadow: 'var(--shadow-lg)', padding: 22, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 750, fontSize: 18 }}>{section.subject.code} · {section.sectionNo}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{name(section.subject.nameEn, null)} — {section.semester.academicYear.code} / {section.semester.nameEn}</div>
          </div>
          <button onClick={onClose} className="glass hairline icon-btn" style={{ width: 34, height: 34, fontSize: 18 }}>×</button>
        </div>

        {/* Basic info */}
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t('secD.basicInfo')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <F label={t('sec.sectionNo')}><input className="input" value={form.sectionNo} onChange={(e) => setForm({ ...form, sectionNo: e.target.value })} /></F>
          <F label={t('sec.capacity')}><input type="number" min={1} className="input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></F>
          <F label={t('sec.room')}>
            <select className="input" value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}>
              <option value="">{t('sec.select')}</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.roomNumber}</option>)}
            </select>
          </F>
          {isAdmin ? (
            <F label={t('sec.lecturer')}>
              <select className="input" value={form.lecturerId} onChange={(e) => setForm({ ...form, lecturerId: e.target.value })}>
                <option value="">{t('sec.select')}</option>
                {lecturers.map((l) => <option key={l.id} value={l.id}>{l.nameEn} ({l.employeeCode})</option>)}
              </select>
            </F>
          ) : (
            <F label={t('sec.lecturer')}><div className="muted" style={{ padding: '12px 0', fontSize: 13.5 }}>{section.lecturer?.nameEn ?? '—'}</div></F>
          )}
        </div>
        <button onClick={saveInfo} disabled={savingInfo} className="btn-primary" style={{ padding: '9px 18px', fontSize: 13.5, marginBottom: 24 }}>{savingInfo ? t('secD.saving') : t('secD.save')}</button>

        {/* Roster */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('secD.roster')} ({section.currentEnrollment}/{section.capacity})</div>
        </div>
        {isFull && <div className="chip chip-warning" style={{ marginBottom: 10 }}>{t('secD.capacityFull')}</div>}

        {/* Add one student — type-ahead over the whole faculty roster, not a
            pre-loaded dropdown (which silently truncated at 200 and showed
            nothing at all to a lecturer once /students became section-scoped). */}
        <div style={{ marginBottom: 10, opacity: isFull ? 0.6 : 1 }}>
          <StudentPicker
            onPick={addStudent}
            excludeSectionId={sectionId}
            disabled={isFull || addingStudent}
            placeholder={t('secD.searchStudent')}
          />
        </div>

        {/* Add a whole group at once */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <select aria-label={t('secD.selectGroup')} className="input" value={addGroupId} onChange={(e) => setAddGroupId(e.target.value)} disabled={isFull}>
            <option value="">{t('secD.selectGroup')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {name(g.nameEn, g.nameTh)} ({g._count.members})
              </option>
            ))}
          </select>
          <button onClick={addGroup} disabled={!addGroupId || addingGroup || isFull} className="glass hairline"
            style={{ padding: '9px 16px', fontSize: 13, whiteSpace: 'nowrap', borderRadius: 11, fontWeight: 650, color: 'var(--text-1)' }}>
            {addingGroup ? '…' : t('secD.addGroup')}
          </button>
        </div>

        {rosterError && <div className="chip chip-danger" role="alert" style={{ display: 'block', borderRadius: 11, padding: '8px 12px', marginBottom: 10, fontSize: 12.5 }}>{rosterError}</div>}

        {groupResult && (
          <div className={`chip ${groupResult.skipped.length ? 'chip-warning' : 'chip-success'}`} style={{ display: 'block', borderRadius: 11, padding: '9px 12px', marginBottom: 10, fontSize: 12.5 }}>
            <div>{t('secD.groupAdded')}: <strong>{groupResult.enrolled}</strong>{groupResult.skipped.length > 0 && <> · {t('secD.groupSkipped')}: <strong>{groupResult.skipped.length}</strong></>}</div>
            {groupResult.skipped.slice(0, 5).map((s) => (
              <div key={s.studentCode} style={{ fontSize: 11.5, marginTop: 3, opacity: 0.9 }}>{s.studentCode} — {s.reason}</div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
          {roster.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: 20, fontSize: 13 }}>{t('secD.noStudents')}</div>
          ) : roster.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--popover-hover)' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: 12.5 }}>{e.student.studentCode}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{name(e.student.nameEn, e.student.nameTh ?? null)}</span>
              <button onClick={() => dropStudent(e.id)} disabled={busyEnrollmentId === e.id} className="btn-danger" style={{ padding: '5px 12px', fontSize: 11.5 }}>
                {busyEnrollmentId === e.id ? '…' : t('secD.dropStudent')}
              </button>
            </div>
          ))}
        </div>

        {/* Rubrics */}
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>{t('secD.rubrics')}</div>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>{t('secD.rubricsHint')}</p>
        {rubricConfig && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {rubricConfig.map((r, i) => (
                <div key={r.rubricId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: r.isActive ? 'var(--popover-hover)' : 'transparent', border: '1px solid var(--glass-hairline)', opacity: r.isActive ? 1 : 0.55 }}>
                  <input type="checkbox" checked={r.isActive}
                    onChange={(e) => setRubricConfig(rubricConfig.map((x, xi) => xi === i ? { ...x, isActive: e.target.checked } : x))}
                    style={{ width: 17, height: 17, cursor: 'pointer' }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{name(r.nameEn, r.nameTh)}</span>
                  <input type="number" min={0} max={100} value={r.weightPercent} disabled={!r.isActive}
                    onChange={(e) => setRubricConfig(rubricConfig.map((x, xi) => xi === i ? { ...x, weightPercent: Number(e.target.value) } : x))}
                    style={{ width: 60, padding: '6px 8px', fontSize: 13, textAlign: 'right', borderRadius: 8, border: '1px solid var(--glass-hairline)', background: 'transparent', color: 'var(--text-0)' }} />
                  <span className="muted" style={{ fontSize: 11.5, width: 14 }}>%</span>
                </div>
              ))}
              {rubricConfig.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>{t('secD.noRubrics')}</div>}
            </div>
            {rubricConfig.length > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12, marginBottom: 8 }}>
                  <span style={{ color: activeSum > 100 ? 'var(--danger)' : 'var(--success)' }}>{activeSum}%</span>
                </div>
                <button onClick={saveRubrics} disabled={savingRubrics || activeSum > 100} className="btn-primary" style={{ width: '100%', padding: 11, fontSize: 13.5 }}>
                  {savingRubrics ? t('secD.saving') : t('secD.save')}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="subtle" style={{ fontSize: 11.5, fontWeight: 600, display: 'block', marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
