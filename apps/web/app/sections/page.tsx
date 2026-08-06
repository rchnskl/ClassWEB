'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import SectionDetailDrawer from '@/components/SectionDetailDrawer';
import { apiFetch, type Paginated } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Tab = 'subjects' | 'sections' | 'departments' | 'programs' | 'locations';

export default function SectionsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('admin@nursing.au.edu');
  const [tab, setTab] = useState<Tab>('sections');
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState('');

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    const u = localStorage.getItem('user');
    if (u) {
      try {
        const parsed = JSON.parse(u);
        setEmail(parsed.email);
        setIsAdmin((parsed.roleCodes ?? []).includes('ADMIN'));
        setUserId(parsed.id);
      } catch {}
    }
  }, [router]);

  return (
    <div className="app-shell">
      <Sidebar active="Sections" />
      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('sec.title')}</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('sec.subtitle')}</p>
        </div>

        <div className="tabbar rise" style={{ marginBottom: 16 }}>
          <button className={`tab ${tab === 'programs' ? 'active' : ''}`} onClick={() => setTab('programs')}>{t('prog.title')}</button>
          <button className={`tab ${tab === 'subjects' ? 'active' : ''}`} onClick={() => setTab('subjects')}>{t('sec.tab.subjects')}</button>
          <button className={`tab ${tab === 'sections' ? 'active' : ''}`} onClick={() => setTab('sections')}>{t('sec.tab.sections')}</button>
          <button className={`tab ${tab === 'departments' ? 'active' : ''}`} onClick={() => setTab('departments')}>{t('dept.title')}</button>
          <button className={`tab ${tab === 'locations' ? 'active' : ''}`} onClick={() => setTab('locations')}>{t('loc.title')}</button>
        </div>

        {tab === 'programs' && <ProgramsTab isAdmin={isAdmin} />}
        {tab === 'subjects' && <SubjectsTab isAdmin={isAdmin} />}
        {tab === 'sections' && <SectionsTab isAdmin={isAdmin} userId={userId} />}
        {tab === 'departments' && <DepartmentsTab isAdmin={isAdmin} />}
        {tab === 'locations' && <LocationsTab isAdmin={isAdmin} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections tab
// ---------------------------------------------------------------------------

interface SectionRow {
  id: string; sectionNo: string; capacity: number; currentEnrollment: number; isActive: boolean;
  subject: { id: string; code: string; nameEn: string; credits: number };
  semester: { id: string; nameEn: string; academicYear: { code: string } };
  lecturer: { id: string; nameEn: string; employeeCode: string; userId: string | null } | null;
  room: { id: string; roomNumber: string } | null;
  _count: { enrollments: number };
}
interface SubjectRef { id: string; code: string; nameEn: string }
interface SemesterRef { id: string; nameEn: string; academicYear: { code: string } }
interface RoomRef { id: string; roomNumber: string }
interface LecturerRef { id: string; nameEn: string; employeeCode: string }

const EMPTY_SECTION_FORM = { subjectId: '', semesterId: '', sectionNo: '', lecturerId: '', roomId: '', capacity: 40 };

function SectionsTab({ isAdmin, userId }: { isAdmin: boolean; userId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<SectionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('');

  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [semesters, setSemesters] = useState<SemesterRef[]>([]);
  const [rooms, setRooms] = useState<RoomRef[]>([]);
  const [lecturers, setLecturers] = useState<LecturerRef[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_SECTION_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ take: '100' });
      if (search) params.set('search', search);
      if (subjectFilter) params.set('subjectId', subjectFilter);
      if (semesterFilter) params.set('semesterId', semesterFilter);
      const data = await apiFetch<Paginated<SectionRow>>(`/sections?${params}`);
      setRows(data.items);
      setTotal(data.total);
    } finally { setLoading(false); }
  }, [search, subjectFilter, semesterFilter]);

  useEffect(() => {
    apiFetch<Paginated<SubjectRef>>('/subjects?take=200').then((d) => setSubjects(d.items)).catch(() => {});
    apiFetch<SemesterRef[]>('/semesters').then(setSemesters).catch(() => {});
    apiFetch<RoomRef[] | Paginated<RoomRef>>('/rooms?take=200').then((d) => setRooms(Array.isArray(d) ? d : d.items)).catch(() => {});
    if (isAdmin) apiFetch<Paginated<LecturerRef>>('/lecturers?take=200').then((d) => setLecturers(d.items)).catch(() => {});
  }, [isAdmin]);

  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load]);

  function openCreate() {
    setForm(EMPTY_SECTION_FORM);
    setFormError(null);
    setShowForm(true);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        subjectId: form.subjectId, semesterId: form.semesterId, sectionNo: form.sectionNo,
        capacity: form.capacity, roomId: form.roomId || undefined,
      };
      if (isAdmin) body.lecturerId = form.lecturerId || undefined;
      await apiFetch('/sections', { method: 'POST', body: JSON.stringify(body) });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create section');
    } finally { setSaving(false); }
  }

  async function removeSection(id: string) {
    if (!window.confirm(t('sec.confirmDelete'))) return;
    setBusyId(id);
    try { await apiFetch(`/sections/${id}`, { method: 'DELETE' }); await load(); }
    catch (err) { window.alert(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="rise" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label={t('sec.allSubjects')} className="input" style={{ width: 'auto', minWidth: 160 }} value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
            <option value="">{t('sec.allSubjects')}</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.nameEn}</option>)}
          </select>
          <select aria-label={t('sec.allSemesters')} className="input" style={{ width: 'auto', minWidth: 160 }} value={semesterFilter} onChange={(e) => setSemesterFilter(e.target.value)}>
            <option value="">{t('sec.allSemesters')}</option>
            {semesters.map((s) => <option key={s.id} value={s.id}>{s.academicYear.code} / {s.nameEn}</option>)}
          </select>
          <input className="input" style={{ width: 220 }} placeholder={t('sec.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => (showForm ? setShowForm(false) : openCreate())} style={{ padding: '11px 18px', fontSize: 14 }}>
          {showForm ? t('sec.close') : t('sec.add')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submitForm} className="glass rise" style={{ padding: 20, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <F label={`${t('sec.subject')} *`}>
            <select className="input" required value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
              <option value="" disabled>{t('sec.select')}</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.nameEn}</option>)}
            </select>
          </F>
          <F label={`${t('sec.semester')} *`}>
            <select className="input" required value={form.semesterId} onChange={(e) => setForm({ ...form, semesterId: e.target.value })}>
              <option value="" disabled>{t('sec.select')}</option>
              {semesters.map((s) => <option key={s.id} value={s.id}>{s.academicYear.code} / {s.nameEn}</option>)}
            </select>
          </F>
          <F label={`${t('sec.sectionNo')} *`}><input className="input" required value={form.sectionNo} onChange={(e) => setForm({ ...form, sectionNo: e.target.value })} placeholder="001" /></F>
          {isAdmin ? (
            <F label={t('sec.lecturer')}>
              <select className="input" value={form.lecturerId} onChange={(e) => setForm({ ...form, lecturerId: e.target.value })}>
                <option value="">{t('sec.select')}</option>
                {lecturers.map((l) => <option key={l.id} value={l.id}>{l.nameEn} ({l.employeeCode})</option>)}
              </select>
            </F>
          ) : null}
          <F label={t('sec.room')}>
            <select className="input" value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}>
              <option value="">{t('sec.select')}</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.roomNumber}</option>)}
            </select>
          </F>
          <F label={t('sec.capacity')}><input type="number" min={1} className="input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></F>
          <button className="btn-primary" type="submit" disabled={saving} style={{ padding: 12, fontSize: 14.5 }}>{saving ? t('sec.saving') : t('sec.create')}</button>
          {!isAdmin && <div className="chip" style={{ gridColumn: '1 / -1', background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>{t('sec.selfAssignHint')}</div>}
          {formError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{formError}</div>}
        </form>
      )}

      <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <Th>{t('sec.subject')}</Th><Th>{t('sec.sectionNo')}</Th><Th>{t('sec.lecturer')}</Th><Th>{t('sec.room')}</Th><Th>{t('sec.enrolled')}</Th><Th>{t('sec.status')}</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 48, textAlign: 'center' }}>
                  <div style={{ fontWeight: 650 }}>{t('sec.none')}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t('sec.noneHint')}</div>
                </td></tr>
              ) : rows.map((s) => {
                const mine = !!s.lecturer?.userId && s.lecturer.userId === userId;
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{s.subject.code}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{s.subject.nameEn}</div>
                    </Td>
                    <Td>{s.sectionNo}</Td>
                    <Td>
                      {s.lecturer ? <span>{s.lecturer.nameEn}</span> : <span className="muted">—</span>}
                      {mine && <div className="chip chip-success" style={{ marginTop: 4 }}>{t('sec.mine')}</div>}
                    </Td>
                    <Td>{s.room?.roomNumber ?? <span className="muted">—</span>}</Td>
                    <Td>{s.currentEnrollment}/{s.capacity}</Td>
                    <Td><span className={`chip ${s.isActive ? 'chip-success' : 'chip-danger'}`}>{s.isActive ? t('sec.active') : t('sec.inactive')}</span></Td>
                    <Td>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => setManagingId(s.id)} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{t('sec.manage')}</button>
                        {isAdmin && (
                          <button onClick={() => removeSection(s.id)} disabled={busyId === s.id} className="btn-danger" style={{ padding: '6px 12px', fontSize: 12 }}>
                            {busyId === s.id ? '…' : t('sec.delete')}
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 14px' }}><span className="muted" style={{ fontSize: 12.5 }}>{total} {t('sec.count')}</span></div>
      </div>

      {managingId && (
        <SectionDetailDrawer sectionId={managingId} isAdmin={isAdmin} onClose={() => setManagingId(null)} onChanged={load} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subjects tab
// ---------------------------------------------------------------------------

const SUBJECT_CATEGORIES = ['GENERAL_EDUCATION', 'PROFESSIONAL_FOUNDATION', 'PROFESSIONAL_THEORY', 'PROFESSIONAL_PRACTICE', 'FREE_ELECTIVE'] as const;

interface SubjectRow {
  id: string; code: string; nameEn: string; nameTh: string | null; credits: number; description: string | null;
  category: string | null; yearLevel: number | null;
  program: { id: string; code: string; nameEn: string };
  course: { id: string; code: string; nameEn: string };
  _count: { sections: number };
}
interface ProgramRef { id: string; code: string; nameEn: string }
interface CourseRef { id: string; code: string; nameEn: string; programId: string }

const EMPTY_SUBJECT_FORM = { programId: '', courseId: '', code: '', nameEn: '', nameTh: '', description: '', credits: 3, category: '', yearLevel: '' };

function SubjectsTab({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [rows, setRows] = useState<SubjectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [programs, setPrograms] = useState<ProgramRef[]>([]);
  const [courses, setCourses] = useState<CourseRef[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_SUBJECT_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showCourseForm, setShowCourseForm] = useState(false);
  const [courseForm, setCourseForm] = useState({ code: '', nameEn: '', nameTh: '' });
  const [savingCourse, setSavingCourse] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ take: '100' });
      if (search) params.set('search', search);
      const data = await apiFetch<Paginated<SubjectRow>>(`/subjects?${params}`);
      setRows(data.items);
      setTotal(data.total);
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => {
    apiFetch<ProgramRef[]>('/programs').then(setPrograms).catch(() => {});
    apiFetch<CourseRef[]>('/courses').then(setCourses).catch(() => {});
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_SUBJECT_FORM);
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row: SubjectRow) {
    setEditingId(row.id);
    setForm({
      programId: row.program.id, courseId: row.course.id, code: row.code, nameEn: row.nameEn, nameTh: row.nameTh ?? '',
      description: row.description ?? '', credits: row.credits, category: row.category ?? '', yearLevel: row.yearLevel != null ? String(row.yearLevel) : '',
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
        ...form, nameTh: form.nameTh || undefined, description: form.description || undefined,
        category: form.category || undefined, yearLevel: form.yearLevel ? Number(form.yearLevel) : undefined,
      };
      if (editingId) await apiFetch(`/subjects/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiFetch('/subjects', { method: 'POST', body: JSON.stringify(body) });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save subject');
    } finally { setSaving(false); }
  }

  async function removeSubject(id: string) {
    if (!window.confirm(t('subj.confirmDelete'))) return;
    setBusyId(id);
    try { await apiFetch(`/subjects/${id}`, { method: 'DELETE' }); await load(); }
    catch (err) { window.alert(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusyId(null); }
  }

  const coursesForProgram = courses.filter((c) => c.programId === form.programId);

  function openCourseForm() {
    setCourseForm({ code: '', nameEn: '', nameTh: '' });
    setCourseError(null);
    setShowCourseForm(true);
  }

  async function submitCourseForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.programId) return;
    setSavingCourse(true);
    setCourseError(null);
    try {
      const created = await apiFetch<CourseRef>('/courses', {
        method: 'POST',
        body: JSON.stringify({ programId: form.programId, code: courseForm.code, nameEn: courseForm.nameEn, nameTh: courseForm.nameTh || undefined }),
      });
      setCourses((prev) => [...prev, created]);
      setForm((f) => ({ ...f, courseId: created.id }));
      setShowCourseForm(false);
    } catch (err) {
      setCourseError(err instanceof Error ? err.message : 'Failed to create course');
    } finally { setSavingCourse(false); }
  }

  return (
    <div>
      <div className="rise" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <input className="input" style={{ width: 260 }} placeholder={t('subj.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        {isAdmin && (
          <button className="btn-primary" onClick={() => (showForm ? setShowForm(false) : openCreate())} style={{ padding: '11px 18px', fontSize: 14 }}>
            {showForm ? t('subj.close') : t('subj.add')}
          </button>
        )}
      </div>

      {showForm && isAdmin && (
        <form onSubmit={submitForm} className="glass rise" style={{ padding: 20, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <F label={`${t('subj.program')} *`}>
            <select className="input" required value={form.programId} onChange={(e) => setForm({ ...form, programId: e.target.value, courseId: '' })}>
              <option value="" disabled>{t('subj.select')}</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameEn}</option>)}
            </select>
          </F>
          <F label={`${t('subj.course')} *`}>
            <div style={{ display: 'flex', gap: 6 }}>
              <select className="input" required value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} disabled={!form.programId} style={{ flex: 1 }}>
                <option value="" disabled>{t('subj.select')}</option>
                {coursesForProgram.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.nameEn}</option>)}
              </select>
              <button type="button" className="glass hairline" disabled={!form.programId} onClick={openCourseForm}
                title={t('subj.addCourse')} style={{ padding: '0 12px', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: form.programId ? 'pointer' : 'not-allowed' }}>+</button>
            </div>
            {form.programId && coursesForProgram.length === 0 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('subj.noCoursesHint')}</div>
            )}
          </F>
          <F label={`${t('subj.code')} *`}><input className="input" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="NUR1103" /></F>
          <F label={`${t('subj.nameEn')} *`}><input className="input" required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></F>
          <F label={t('subj.nameTh')}><input className="input" value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} /></F>
          <F label={t('subj.credits')}><input type="number" min={0} max={12} className="input" value={form.credits} onChange={(e) => setForm({ ...form, credits: Number(e.target.value) })} /></F>
          <F label={t('subj.category')}>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">{t('subj.select')}</option>
              {SUBJECT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`subj.category.${c}`)}</option>)}
            </select>
          </F>
          <F label={t('subj.yearLevel')}>
            <select className="input" value={form.yearLevel} onChange={(e) => setForm({ ...form, yearLevel: e.target.value })}>
              <option value="">{t('students.noYear')}</option>
              {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{t('common.year')} {y}</option>)}
            </select>
          </F>
          <F label={t('subj.description')}><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></F>
          <button className="btn-primary" type="submit" disabled={saving} style={{ padding: 12, fontSize: 14.5 }}>{saving ? t('subj.saving') : editingId ? t('subj.save') : t('subj.create')}</button>
          {formError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{formError}</div>}
        </form>
      )}

      {showCourseForm && isAdmin && (
        <form onSubmit={submitCourseForm} className="glass rise" style={{ padding: 20, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end', border: '1px solid var(--brand-orange)' }}>
          <div style={{ gridColumn: '1 / -1', fontWeight: 650, fontSize: 14 }}>{t('subj.addCourse')}</div>
          <F label={`${t('subj.courseCode')} *`}><input className="input" required value={courseForm.code} onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })} placeholder="NUR-FND" /></F>
          <F label={`${t('subj.courseNameEn')} *`}><input className="input" required value={courseForm.nameEn} onChange={(e) => setCourseForm({ ...courseForm, nameEn: e.target.value })} /></F>
          <F label={t('subj.courseNameTh')}><input className="input" value={courseForm.nameTh} onChange={(e) => setCourseForm({ ...courseForm, nameTh: e.target.value })} /></F>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" type="submit" disabled={savingCourse} style={{ padding: 12, fontSize: 14 }}>{savingCourse ? t('subj.saving') : t('subj.create')}</button>
            <button type="button" className="glass hairline" onClick={() => setShowCourseForm(false)} style={{ padding: 12, borderRadius: 10, fontSize: 14, fontWeight: 600 }}>{t('subj.close')}</button>
          </div>
          {courseError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{courseError}</div>}
        </form>
      )}

      <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <Th>{t('subj.code')}</Th><Th>{t('subj.nameEn')}</Th><Th>{t('subj.program')}</Th><Th>{t('subj.category')}</Th><Th>{t('subj.yearLevel')}</Th><Th>{t('subj.credits')}</Th><Th>{t('subj.sections')}</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 48, textAlign: 'center' }}>
                  <div style={{ fontWeight: 650 }}>{t('subj.none')}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t('subj.noneHint')}</div>
                </td></tr>
              ) : rows.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                  <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{s.code}</span></Td>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{name(s.nameEn, s.nameTh)}</div>
                    {s.description && <div className="muted" style={{ fontSize: 12 }}>{s.description}</div>}
                  </Td>
                  <Td><span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>{s.program.code}</span></Td>
                  <Td>{s.category ? <span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-1)', fontSize: 11.5 }}>{t(`subj.category.${s.category}`)}</span> : <span className="muted">—</span>}</Td>
                  <Td>{s.yearLevel ?? <span className="muted">—</span>}</Td>
                  <Td>{s.credits}</Td>
                  <Td>{s._count.sections}</Td>
                  <Td>
                    {isAdmin && (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => openEdit(s)} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>✏️</button>
                        <button onClick={() => removeSubject(s.id)} disabled={busyId === s.id} className="btn-danger" style={{ padding: '6px 12px', fontSize: 12 }}>
                          {busyId === s.id ? '…' : t('subj.delete')}
                        </button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 14px' }}><span className="muted" style={{ fontSize: 12.5 }}>{total} {t('subj.count')}</span></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Departments tab
// ---------------------------------------------------------------------------

interface DepartmentRow {
  id: string; code: string; nameEn: string; nameTh: string | null; isActive: boolean;
  faculty: { id: string; code: string; nameEn: string };
  head: { id: string; nameEn: string; nameTh: string | null } | null;
  _count: { lecturers: number };
}
interface FacultyRef { id: string; code: string; nameEn: string }
interface LecturerHeadRef { id: string; nameEn: string; employeeCode: string }

const EMPTY_DEPT_FORM = { facultyId: '', code: '', nameEn: '', nameTh: '', headId: '' };

function DepartmentsTab({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [faculties, setFaculties] = useState<FacultyRef[]>([]);
  const [lecturers, setLecturers] = useState<LecturerHeadRef[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_DEPT_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => { setRows(await apiFetch<DepartmentRow[]>('/departments')); }, []);
  useEffect(() => {
    void load();
    apiFetch<Paginated<LecturerHeadRef>>('/lecturers?take=200').then((d) => setLecturers(d.items)).catch(() => {});
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_DEPT_FORM);
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row: DepartmentRow) {
    setEditingId(row.id);
    setForm({ facultyId: row.faculty.id, code: row.code, nameEn: row.nameEn, nameTh: row.nameTh ?? '', headId: row.head?.id ?? '' });
    setFacultiesFromRow(row);
    setFormError(null);
    setShowForm(true);
  }
  function setFacultiesFromRow(row: DepartmentRow) {
    setFaculties((prev) => (prev.some((f) => f.id === row.faculty.id) ? prev : [...prev, row.faculty]));
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const body = { ...form, nameTh: form.nameTh || undefined, headId: form.headId || undefined };
      if (editingId) await apiFetch(`/departments/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiFetch('/departments', { method: 'POST', body: JSON.stringify(body) });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save department');
    } finally { setSaving(false); }
  }

  async function removeDept(id: string) {
    if (!window.confirm(t('dept.confirmDelete'))) return;
    setBusyId(id);
    try { await apiFetch(`/departments/${id}`, { method: 'DELETE' }); await load(); }
    catch (err) { window.alert(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusyId(null); }
  }

  useEffect(() => {
    if (rows.length && faculties.length === 0) {
      const uniq = new Map(rows.map((r) => [r.faculty.id, r.faculty]));
      setFaculties([...uniq.values()]);
    }
  }, [rows, faculties.length]);

  return (
    <div>
      {isAdmin && (
        <div className="rise" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button className="btn-primary" onClick={() => (showForm ? setShowForm(false) : openCreate())} style={{ padding: '11px 18px', fontSize: 14 }}>
            {showForm ? t('dept.close') : t('dept.add')}
          </button>
        </div>
      )}

      {showForm && isAdmin && (
        <form onSubmit={submitForm} className="glass rise" style={{ padding: 20, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <F label={`${t('dept.code')} *`}><input className="input" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="ADULT" /></F>
          <F label={`${t('dept.nameEn')} *`}><input className="input" required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></F>
          <F label={t('dept.nameTh')}><input className="input" value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} /></F>
          <F label={t('dept.head')}>
            <select className="input" value={form.headId} onChange={(e) => setForm({ ...form, headId: e.target.value })}>
              <option value="">{t('dept.select')}</option>
              {lecturers.map((l) => <option key={l.id} value={l.id}>{l.nameEn} ({l.employeeCode})</option>)}
            </select>
          </F>
          {!editingId && faculties.length > 0 && (
            <F label={`Faculty *`}>
              <select className="input" required value={form.facultyId} onChange={(e) => setForm({ ...form, facultyId: e.target.value })}>
                <option value="" disabled>{t('dept.select')}</option>
                {faculties.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.nameEn}</option>)}
              </select>
            </F>
          )}
          <button className="btn-primary" type="submit" disabled={saving} style={{ padding: 12, fontSize: 14.5 }}>{saving ? t('dept.saving') : editingId ? t('dept.save') : t('dept.create')}</button>
          {formError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{formError}</div>}
        </form>
      )}

      <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <Th>{t('dept.code')}</Th><Th>{t('dept.nameEn')}</Th><Th>{t('dept.head')}</Th><Th>{t('dept.lecturers')}</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('dept.none')}</td></tr>
              ) : rows.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                  <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{d.code}</span></Td>
                  <Td>{name(d.nameEn, d.nameTh)}</Td>
                  <Td>{d.head ? name(d.head.nameEn, d.head.nameTh) : <span className="muted">—</span>}</Td>
                  <Td>{d._count.lecturers}</Td>
                  <Td>
                    {isAdmin && (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => openEdit(d)} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>✏️</button>
                        <button onClick={() => removeDept(d.id)} disabled={busyId === d.id} className="btn-danger" style={{ padding: '6px 12px', fontSize: 12 }}>
                          {busyId === d.id ? '…' : t('dept.delete')}
                        </button>
                      </div>
                    )}
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

// ---------------------------------------------------------------------------
// Programs tab
// ---------------------------------------------------------------------------

interface ProgramRow {
  id: string; code: string; nameEn: string; nameTh: string | null;
  degreeType: string | null; durationYrs: number | null; totalCredits: number | null;
  curriculumYearBE: number | null;
  faculty: { id: string; code: string; nameEn: string };
  _count: { courses: number; subjects: number; students: number };
}

const EMPTY_PROGRAM_FORM = { facultyId: '', code: '', nameEn: '', nameTh: '', degreeType: '', durationYrs: '', totalCredits: '', curriculumYearBE: '' };

function ProgramsTab({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [rows, setRows] = useState<ProgramRow[]>([]);
  const [faculties, setFaculties] = useState<FacultyRef[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_PROGRAM_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => { setRows(await apiFetch<ProgramRow[]>('/programs')); }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (rows.length && faculties.length === 0) {
      const uniq = new Map(rows.map((r) => [r.faculty.id, r.faculty]));
      setFaculties([...uniq.values()]);
    }
  }, [rows, faculties.length]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_PROGRAM_FORM);
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row: ProgramRow) {
    setEditingId(row.id);
    setForm({
      facultyId: row.faculty.id, code: row.code, nameEn: row.nameEn, nameTh: row.nameTh ?? '',
      degreeType: row.degreeType ?? '', durationYrs: row.durationYrs != null ? String(row.durationYrs) : '',
      totalCredits: row.totalCredits != null ? String(row.totalCredits) : '',
      curriculumYearBE: row.curriculumYearBE != null ? String(row.curriculumYearBE) : '',
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
        ...form,
        nameTh: form.nameTh || undefined,
        degreeType: form.degreeType || undefined,
        durationYrs: form.durationYrs ? Number(form.durationYrs) : undefined,
        totalCredits: form.totalCredits ? Number(form.totalCredits) : undefined,
        curriculumYearBE: form.curriculumYearBE ? Number(form.curriculumYearBE) : undefined,
      };
      if (editingId) await apiFetch(`/programs/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiFetch('/programs', { method: 'POST', body: JSON.stringify(body) });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save program');
    } finally { setSaving(false); }
  }

  async function removeProgram(id: string) {
    if (!window.confirm(t('prog.confirmDelete'))) return;
    setBusyId(id);
    try { await apiFetch(`/programs/${id}`, { method: 'DELETE' }); await load(); }
    catch (err) { window.alert(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      {isAdmin && (
        <div className="rise" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button className="btn-primary" onClick={() => (showForm ? setShowForm(false) : openCreate())} style={{ padding: '11px 18px', fontSize: 14 }}>
            {showForm ? t('subj.close') : t('prog.add')}
          </button>
        </div>
      )}

      {showForm && isAdmin && (
        <form onSubmit={submitForm} className="glass rise" style={{ padding: 20, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
          <F label={`${t('prog.code')} *`}><input className="input" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BNS" /></F>
          <F label={`${t('subj.nameEn')} *`}><input className="input" required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} placeholder="Bachelor of Nursing Science" /></F>
          <F label={t('subj.nameTh')}><input className="input" value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} /></F>
          <F label={t('prog.degreeType')}><input className="input" value={form.degreeType} onChange={(e) => setForm({ ...form, degreeType: e.target.value })} placeholder="Bachelor" /></F>
          <F label={t('prog.durationYrs')}><input type="number" min={1} max={10} className="input" value={form.durationYrs} onChange={(e) => setForm({ ...form, durationYrs: e.target.value })} /></F>
          <F label={t('prog.totalCredits')}><input type="number" min={1} className="input" value={form.totalCredits} onChange={(e) => setForm({ ...form, totalCredits: e.target.value })} /></F>
          <F label={t('prog.curriculumYear')}><input type="number" min={2400} max={2700} className="input" placeholder="2565" value={form.curriculumYearBE} onChange={(e) => setForm({ ...form, curriculumYearBE: e.target.value })} /></F>
          {!editingId && faculties.length > 0 && (
            <F label="Faculty *">
              <select className="input" required value={form.facultyId} onChange={(e) => setForm({ ...form, facultyId: e.target.value })}>
                <option value="" disabled>{t('subj.select')}</option>
                {faculties.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.nameEn}</option>)}
              </select>
            </F>
          )}
          <button className="btn-primary" type="submit" disabled={saving} style={{ padding: 12, fontSize: 14.5 }}>{saving ? t('subj.saving') : editingId ? t('subj.save') : t('subj.create')}</button>
          {formError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{formError}</div>}
        </form>
      )}

      <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <Th>{t('prog.code')}</Th><Th>{t('subj.nameEn')}</Th><Th>{t('prog.curriculumYear')}</Th><Th>{t('prog.durationYrs')}</Th><Th>{t('subj.sections')}</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('prog.none')}</td></tr>
              ) : rows.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                  <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{p.code}</span></Td>
                  <Td>{name(p.nameEn, p.nameTh)}</Td>
                  <Td>{p.curriculumYearBE ?? <span className="muted">—</span>}</Td>
                  <Td>{p.durationYrs ?? <span className="muted">—</span>}</Td>
                  <Td>{p._count.courses} {t('prog.courses')} · {p._count.subjects} {t('subj.sections')}</Td>
                  <Td>
                    {isAdmin && (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => openEdit(p)} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>✏️</button>
                        <button onClick={() => removeProgram(p.id)} disabled={busyId === p.id} className="btn-danger" style={{ padding: '6px 12px', fontSize: 12 }}>
                          {busyId === p.id ? '…' : t('subj.delete')}
                        </button>
                      </div>
                    )}
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

// ---------------------------------------------------------------------------
// Locations tab — campuses (incl. external clinical sites) and buildings
// ---------------------------------------------------------------------------

const CAMPUS_TYPES = ['CAMPUS', 'HOSPITAL', 'HEALTH_PROMOTING_HOSPITAL', 'HEALTH_SERVICE_CENTER', 'CLINIC', 'MEDICAL_CENTER'] as const;

interface CampusRow {
  id: string; code: string; nameEn: string; nameTh: string | null; locationType: string; address: string | null; city: string | null;
  _count: { buildings: number };
}
interface BuildingRow {
  id: string; code: string; nameEn: string; nameTh: string | null; floors: number | null;
  campus: { id: string; code: string; nameEn: string; locationType: string };
  _count: { rooms: number };
}

const EMPTY_CAMPUS_FORM = { code: '', nameEn: '', nameTh: '', locationType: 'CAMPUS', address: '', city: '' };
const EMPTY_BUILDING_FORM = { campusId: '', code: '', nameEn: '', nameTh: '', floors: '1' };

function LocationsTab({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [campuses, setCampuses] = useState<CampusRow[]>([]);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [selectedCampusId, setSelectedCampusId] = useState<string | null>(null);

  const [showCampusForm, setShowCampusForm] = useState(false);
  const [editingCampusId, setEditingCampusId] = useState<string | null>(null);
  const [campusForm, setCampusForm] = useState(EMPTY_CAMPUS_FORM);
  const [savingCampus, setSavingCampus] = useState(false);
  const [campusError, setCampusError] = useState<string | null>(null);
  const [busyCampusId, setBusyCampusId] = useState<string | null>(null);

  const [showBuildingForm, setShowBuildingForm] = useState(false);
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null);
  const [buildingForm, setBuildingForm] = useState(EMPTY_BUILDING_FORM);
  const [savingBuilding, setSavingBuilding] = useState(false);
  const [buildingError, setBuildingError] = useState<string | null>(null);
  const [busyBuildingId, setBusyBuildingId] = useState<string | null>(null);

  const loadCampuses = useCallback(async () => {
    const data = await apiFetch<Paginated<CampusRow>>('/locations/campuses?take=100');
    setCampuses(data.items);
  }, []);
  const loadBuildings = useCallback(async () => {
    const data = await apiFetch<Paginated<BuildingRow>>('/locations/buildings?take=200');
    setBuildings(data.items);
  }, []);
  useEffect(() => { void loadCampuses(); void loadBuildings(); }, [loadCampuses, loadBuildings]);

  function openCreateCampus() {
    setEditingCampusId(null);
    setCampusForm(EMPTY_CAMPUS_FORM);
    setCampusError(null);
    setShowCampusForm(true);
  }
  function openEditCampus(row: CampusRow) {
    setEditingCampusId(row.id);
    setCampusForm({ code: row.code, nameEn: row.nameEn, nameTh: row.nameTh ?? '', locationType: row.locationType, address: row.address ?? '', city: row.city ?? '' });
    setCampusError(null);
    setShowCampusForm(true);
  }
  async function submitCampusForm(e: React.FormEvent) {
    e.preventDefault();
    setSavingCampus(true);
    setCampusError(null);
    try {
      const body = { ...campusForm, nameTh: campusForm.nameTh || undefined, address: campusForm.address || undefined, city: campusForm.city || undefined };
      if (editingCampusId) await apiFetch(`/locations/campuses/${editingCampusId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiFetch('/locations/campuses', { method: 'POST', body: JSON.stringify(body) });
      setShowCampusForm(false);
      await loadCampuses();
    } catch (err) {
      setCampusError(err instanceof Error ? err.message : 'Failed to save location');
    } finally { setSavingCampus(false); }
  }
  async function removeCampus(id: string) {
    if (!window.confirm(t('loc.confirmDeleteCampus'))) return;
    setBusyCampusId(id);
    try { await apiFetch(`/locations/campuses/${id}`, { method: 'DELETE' }); await loadCampuses(); }
    catch (err) { window.alert(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusyCampusId(null); }
  }

  function openCreateBuilding(campusId?: string) {
    setEditingBuildingId(null);
    setBuildingForm({ ...EMPTY_BUILDING_FORM, campusId: campusId ?? selectedCampusId ?? '' });
    setBuildingError(null);
    setShowBuildingForm(true);
  }
  function openEditBuilding(row: BuildingRow) {
    setEditingBuildingId(row.id);
    setBuildingForm({ campusId: row.campus.id, code: row.code, nameEn: row.nameEn, nameTh: row.nameTh ?? '', floors: row.floors != null ? String(row.floors) : '1' });
    setBuildingError(null);
    setShowBuildingForm(true);
  }
  async function submitBuildingForm(e: React.FormEvent) {
    e.preventDefault();
    setSavingBuilding(true);
    setBuildingError(null);
    try {
      const body = { ...buildingForm, nameTh: buildingForm.nameTh || undefined, floors: buildingForm.floors ? Number(buildingForm.floors) : undefined };
      if (editingBuildingId) await apiFetch(`/locations/buildings/${editingBuildingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiFetch('/locations/buildings', { method: 'POST', body: JSON.stringify(body) });
      setShowBuildingForm(false);
      await loadBuildings();
      await loadCampuses();
    } catch (err) {
      setBuildingError(err instanceof Error ? err.message : 'Failed to save building');
    } finally { setSavingBuilding(false); }
  }
  async function removeBuilding(id: string) {
    if (!window.confirm(t('loc.confirmDeleteBuilding'))) return;
    setBusyBuildingId(id);
    try { await apiFetch(`/locations/buildings/${id}`, { method: 'DELETE' }); await loadBuildings(); await loadCampuses(); }
    catch (err) { window.alert(err instanceof Error ? err.message : 'Failed'); }
    finally { setBusyBuildingId(null); }
  }

  const visibleBuildings = selectedCampusId ? buildings.filter((b) => b.campus.id === selectedCampusId) : buildings;

  return (
    <div>
      <div className="rise" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t('loc.subtitle')}</p>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="glass hairline" onClick={() => (showBuildingForm ? setShowBuildingForm(false) : openCreateBuilding())}
              style={{ padding: '11px 16px', fontSize: 13.5, borderRadius: 12, fontWeight: 650, color: 'var(--text-1)' }}>
              {showBuildingForm ? t('subj.close') : t('loc.addBuilding')}
            </button>
            <button className="btn-primary" onClick={() => (showCampusForm ? setShowCampusForm(false) : openCreateCampus())} style={{ padding: '11px 18px', fontSize: 14 }}>
              {showCampusForm ? t('subj.close') : t('loc.addCampus')}
            </button>
          </div>
        )}
      </div>

      {showCampusForm && isAdmin && (
        <form onSubmit={submitCampusForm} className="glass rise" style={{ padding: 20, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <F label={`${t('loc.code')} *`}><input className="input" required value={campusForm.code} onChange={(e) => setCampusForm({ ...campusForm, code: e.target.value })} placeholder="MAIN" /></F>
          <F label={`${t('subj.nameEn')} *`}><input className="input" required value={campusForm.nameEn} onChange={(e) => setCampusForm({ ...campusForm, nameEn: e.target.value })} /></F>
          <F label={t('subj.nameTh')}><input className="input" value={campusForm.nameTh} onChange={(e) => setCampusForm({ ...campusForm, nameTh: e.target.value })} /></F>
          <F label={`${t('loc.type')} *`}>
            <select className="input" required value={campusForm.locationType} onChange={(e) => setCampusForm({ ...campusForm, locationType: e.target.value })}>
              {CAMPUS_TYPES.map((c) => <option key={c} value={c}>{t(`loc.type.${c}`)}</option>)}
            </select>
          </F>
          <F label={t('loc.address')}><input className="input" value={campusForm.address} onChange={(e) => setCampusForm({ ...campusForm, address: e.target.value })} /></F>
          <F label={t('loc.city')}><input className="input" value={campusForm.city} onChange={(e) => setCampusForm({ ...campusForm, city: e.target.value })} /></F>
          <button className="btn-primary" type="submit" disabled={savingCampus} style={{ padding: 12, fontSize: 14.5 }}>{savingCampus ? t('subj.saving') : editingCampusId ? t('subj.save') : t('subj.create')}</button>
          {campusError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{campusError}</div>}
        </form>
      )}

      {showBuildingForm && isAdmin && (
        <form onSubmit={submitBuildingForm} className="glass rise" style={{ padding: 20, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end', border: '1px solid var(--brand-orange)' }}>
          <div style={{ gridColumn: '1 / -1', fontWeight: 650, fontSize: 14 }}>{t('loc.addBuilding')}</div>
          <F label={`${t('loc.title')} *`}>
            <select className="input" required value={buildingForm.campusId} onChange={(e) => setBuildingForm({ ...buildingForm, campusId: e.target.value })}>
              <option value="" disabled>{t('subj.select')}</option>
              {campuses.map((c) => <option key={c.id} value={c.id}>{c.code} — {name(c.nameEn, c.nameTh)}</option>)}
            </select>
          </F>
          <F label={`${t('loc.code')} *`}><input className="input" required value={buildingForm.code} onChange={(e) => setBuildingForm({ ...buildingForm, code: e.target.value })} placeholder="CL" /></F>
          <F label={`${t('subj.nameEn')} *`}><input className="input" required value={buildingForm.nameEn} onChange={(e) => setBuildingForm({ ...buildingForm, nameEn: e.target.value })} /></F>
          <F label={t('subj.nameTh')}><input className="input" value={buildingForm.nameTh} onChange={(e) => setBuildingForm({ ...buildingForm, nameTh: e.target.value })} /></F>
          <F label={t('loc.floors')}><input type="number" min={1} className="input" value={buildingForm.floors} onChange={(e) => setBuildingForm({ ...buildingForm, floors: e.target.value })} /></F>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" type="submit" disabled={savingBuilding} style={{ padding: 12, fontSize: 14 }}>{savingBuilding ? t('subj.saving') : editingBuildingId ? t('subj.save') : t('subj.create')}</button>
            <button type="button" className="glass hairline" onClick={() => setShowBuildingForm(false)} style={{ padding: 12, borderRadius: 10, fontSize: 14, fontWeight: 600 }}>{t('subj.close')}</button>
          </div>
          {buildingError && <div className="chip chip-danger" style={{ gridColumn: '1 / -1', borderRadius: 12, padding: '9px 12px' }}>{buildingError}</div>}
        </form>
      )}

      {/* Campuses / sites */}
      <div className="glass rise" style={{ padding: 8, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <Th>{t('loc.code')}</Th><Th>{t('subj.nameEn')}</Th><Th>{t('loc.type')}</Th><Th>{t('loc.buildings')}</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {campuses.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('loc.none')}</td></tr>
              ) : campuses.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--glass-hairline)', background: selectedCampusId === c.id ? 'var(--glass-hairline)' : undefined, cursor: 'pointer' }}
                  onClick={() => setSelectedCampusId(selectedCampusId === c.id ? null : c.id)}>
                  <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{c.code}</span></Td>
                  <Td>{name(c.nameEn, c.nameTh)}{c.city && <span className="muted" style={{ fontSize: 12 }}> · {c.city}</span>}</Td>
                  <Td><span className="chip" style={{ background: c.locationType === 'CAMPUS' ? 'var(--glass-hairline)' : 'var(--chip-info-bg, rgba(94,144,255,0.15))', color: 'var(--text-1)', fontSize: 11.5 }}>{t(`loc.type.${c.locationType}`)}</span></Td>
                  <Td>{c._count.buildings}</Td>
                  <td style={{ padding: '13px 14px' }} onClick={(e) => e.stopPropagation()}>
                    {isAdmin && (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => openEditCampus(c)} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>✏️</button>
                        <button onClick={() => removeCampus(c.id)} disabled={busyCampusId === c.id} className="btn-danger" style={{ padding: '6px 12px', fontSize: 12 }}>
                          {busyCampusId === c.id ? '…' : t('subj.delete')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Buildings — filtered by the selected campus/site above, if any */}
      <div className="glass rise" style={{ padding: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px 0' }}>
          <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
            {selectedCampusId ? `${t('loc.buildings')} — ${name(campuses.find((c) => c.id === selectedCampusId)?.nameEn ?? '', campuses.find((c) => c.id === selectedCampusId)?.nameTh ?? null)}` : t('loc.allBuildings')}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <Th>{t('loc.code')}</Th><Th>{t('subj.nameEn')}</Th><Th>{t('loc.title')}</Th><Th>{t('loc.floors')}</Th><Th>{t('loc.rooms')}</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {visibleBuildings.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center' }} className="muted">{t('loc.noneBuildings')}</td></tr>
              ) : visibleBuildings.map((b) => (
                <tr key={b.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                  <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{b.code}</span></Td>
                  <Td>{name(b.nameEn, b.nameTh)}</Td>
                  <Td>{b.campus.code}</Td>
                  <Td>{b.floors ?? <span className="muted">—</span>}</Td>
                  <Td>{b._count.rooms}</Td>
                  <Td>
                    {isAdmin && (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => openEditBuilding(b)} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>✏️</button>
                        <button onClick={() => removeBuilding(b.id)} disabled={busyBuildingId === b.id} className="btn-danger" style={{ padding: '6px 12px', fontSize: 12 }}>
                          {busyBuildingId === b.id ? '…' : t('subj.delete')}
                        </button>
                      </div>
                    )}
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
  return <td style={{ padding: '13px 14px' }}>{children}</td>;
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="subtle" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
