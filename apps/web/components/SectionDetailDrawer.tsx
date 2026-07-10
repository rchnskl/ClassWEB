'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, type Paginated } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

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
interface EnrollmentRow { id: string; status: string; student: { id: string; studentCode: string; nameEn: string } }
interface StudentRef { id: string; studentCode: string; nameEn: string; nameTh: string | null }
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
  const [students, setStudents] = useState<StudentRef[]>([]);
  const [addStudentId, setAddStudentId] = useState('');
  const [addingStudent, setAddingStudent] = useState(false);
  const [busyEnrollmentId, setBusyEnrollmentId] = useState<string | null>(null);

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
      apiFetch<Paginated<StudentRef>>('/students?take=200').then((d) => setStudents(d.items)).catch(() => {});
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

  const availableStudents = students.filter((s) => !roster.some((r) => r.student.id === s.id));

  async function addStudent() {
    if (!addStudentId) return;
    setAddingStudent(true);
    try {
      await apiFetch('/enrollments', { method: 'POST', body: JSON.stringify({ sectionId, studentId: addStudentId }) });
      setAddStudentId('');
      await loadRoster();
      await loadSection();
      onChanged();
    } finally { setAddingStudent(false); }
  }

  async function dropStudent(enrollmentId: string) {
    if (!window.confirm(t('secD.confirmDrop'))) return;
    setBusyEnrollmentId(enrollmentId);
    try {
      await apiFetch(`/enrollments/${enrollmentId}/drop`, { method: 'PATCH', body: JSON.stringify({}) });
      await loadRoster();
      await loadSection();
      onChanged();
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <select className="input" value={addStudentId} onChange={(e) => setAddStudentId(e.target.value)} disabled={isFull}>
            <option value="">{t('secD.selectStudent')}</option>
            {availableStudents.map((s) => <option key={s.id} value={s.id}>{s.studentCode} — {name(s.nameEn, s.nameTh)}</option>)}
          </select>
          <button onClick={addStudent} disabled={!addStudentId || addingStudent || isFull} className="btn-primary" style={{ padding: '9px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>
            {addingStudent ? '…' : t('secD.addStudent')}
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
          {roster.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: 20, fontSize: 13 }}>{t('secD.noStudents')}</div>
          ) : roster.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--popover-hover)' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: 12.5 }}>{e.student.studentCode}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{e.student.nameEn}</span>
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
