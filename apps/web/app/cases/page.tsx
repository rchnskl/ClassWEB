'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useStoredUser } from '@/lib/local-store';
import { todayBangkok } from '@/lib/dates';

interface SectionRef { id: string; sectionNo: string; subject: { id: string; code: string; nameEn: string } }
interface SessionRef { id: string; sessionDate: string; startTime: string; endTime: string; topic: string | null }
interface StudentRef { id: string; studentCode: string; nameEn: string; nameTh: string | null }
interface Note { id: string; studentId: string; content: string; authorName: string; createdAt: string }
interface PatientCase {
  id: string; bed: string | null; hn: string | null; patientName: string | null; patientAge: string | null;
  diagnosis: string | null; note: string | null; students: StudentRef[];
}
interface DayData { session: SessionRef; cases: PatientCase[]; roster: (StudentRef & { notes: Note[] })[] }
type CaseForm = { bed: string; hn: string; patientName: string; patientAge: string; diagnosis: string; note: string; studentIds: string[] };

const EMPTY: CaseForm = { bed: '', hn: '', patientName: '', patientAge: '', diagnosis: '', note: '', studentIds: [] };

const input: React.CSSProperties = {
  width: '100%', padding: '9px 11px', fontSize: 14, borderRadius: 10, border: '1px solid var(--glass-hairline)',
  background: 'var(--popover-bg)', color: 'var(--text-0)', boxSizing: 'border-box',
};

/**
 * Daily cases: on each practice day students (usually in pairs) are given a
 * patient — bed, HN, name, age — and the lecturer keeps notes on each
 * student for that day.
 */
export default function CasesPage() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const email = useStoredUser()?.email ?? '';
  const sname = (s: StudentRef) => (lang === 'th' && s.nameTh ? s.nameTh : s.nameEn);
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  const [sections, setSections] = useState<SectionRef[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [sessions, setSessions] = useState<SessionRef[] | null>(null); // null = loading
  const [sessionId, setSessionId] = useState('');
  const [day, setDay] = useState<DayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // case id, 'new', or null
  const [form, setForm] = useState<CaseForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);

  const loadDay = useCallback(async (id: string) => {
    try { setDay(await apiFetch<DayData>(`/cases?classSessionId=${id}`)); }
    catch (err) { setDay(null); setError(err instanceof Error ? err.message : String(err)); }
  }, []);

  const loadSessions = useCallback(async (secId: string) => {
    try {
      const r = await apiFetch<{ items: SessionRef[] }>(`/timetable/sessions?sectionId=${secId}`);
      setSessions(r.items);
      // Open on today's practice day, else the next one, else the last.
      const today = todayBangkok();
      const pick = r.items.find((s) => s.sessionDate.slice(0, 10) === today)
        ?? r.items.find((s) => s.sessionDate.slice(0, 10) > today) ?? r.items[r.items.length - 1];
      setSessionId(pick?.id ?? '');
      if (pick) await loadDay(pick.id); else setDay(null);
    } catch { setSessions([]); setDay(null); }
  }, [loadDay]);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    apiFetch<{ items: SectionRef[] }>('/sections').then((d) => {
      setSections(d.items);
      if (d.items[0]) { setSectionId(d.items[0].id); void loadSessions(d.items[0].id); } else setSessions([]);
    }).catch(() => setSessions([]));
  }, [router, loadSessions]);

  function pickSection(id: string) { setSectionId(id); setEditing(null); setSessions(null); void loadSessions(id); }
  function pickDay(id: string) { setSessionId(id); setEditing(null); void loadDay(id); }

  function startNew() { setForm(EMPTY); setEditing('new'); setError(null); }
  function startEdit(c: PatientCase) {
    setForm({ bed: c.bed ?? '', hn: c.hn ?? '', patientName: c.patientName ?? '', patientAge: c.patientAge ?? '',
      diagnosis: c.diagnosis ?? '', note: c.note ?? '', studentIds: c.students.map((s) => s.id) });
    setEditing(c.id); setError(null);
  }
  function toggleStudent(id: string) {
    setForm((f) => ({ ...f, studentIds: f.studentIds.includes(id) ? f.studentIds.filter((x) => x !== id) : [...f.studentIds, id] }));
  }

  async function saveCase() {
    if (!sessionId || !editing) return;
    if (form.studentIds.length === 0) { setError(t('case.needStudent')); return; }
    setBusy(true); setError(null);
    const fields = Object.fromEntries(
      (['bed', 'hn', 'patientName', 'patientAge', 'diagnosis', 'note'] as const).map((k) => [k, form[k].trim()]),
    );
    try {
      if (editing === 'new') {
        await apiFetch('/cases', { method: 'POST', body: JSON.stringify({ classSessionId: sessionId, studentIds: form.studentIds, ...fields }) });
      } else {
        await apiFetch(`/cases/${editing}`, { method: 'PATCH', body: JSON.stringify({ studentIds: form.studentIds, ...fields }) });
      }
      setEditing(null);
      await loadDay(sessionId);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function deleteCase(id: string) {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setBusy(true); setError(null);
    try { await apiFetch(`/cases/${id}`, { method: 'DELETE' }); await loadDay(sessionId); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); setConfirmDelete(null); }
  }

  async function addNote(studentId: string) {
    const content = (drafts[studentId] ?? '').trim();
    if (!content || !sessionId) return;
    setSavingNote(studentId); setError(null);
    try {
      await apiFetch('/cases/notes', { method: 'POST', body: JSON.stringify({ classSessionId: sessionId, studentId, content }) });
      setDrafts((d) => ({ ...d, [studentId]: '' }));
      await loadDay(sessionId);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSavingNote(null); }
  }

  const caseOf = (studentId: string) => day?.cases.find((c) => c.students.some((s) => s.id === studentId));
  const unassigned = day ? day.roster.filter((r) => !caseOf(r.id)) : [];

  return (
    <div className="app-shell">
      <Sidebar active="Cases" />
      <div className="app-main">
        <Topbar email={email} />

        {error && (
          <div className="chip chip-danger" role="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', marginBottom: 12 }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label={t('common.close')} className="icon-btn" style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
        )}

        <div className="rise" style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('case.title')}</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('case.subtitle')}</p>
        </div>

        <div className="glass rise" style={{ padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <select value={sectionId} onChange={(e) => pickSection(e.target.value)} aria-label={t('case.section')} style={{ ...input, maxWidth: 420 }}>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.subject.code} · {t('case.group')} {s.sectionNo} — {s.subject.nameEn}</option>)}
          </select>
          {sessions === null ? (
            <div className="muted" style={{ fontSize: 13 }}>{t('common.loading')}</div>
          ) : sessions.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{t('case.noDays')}</div>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sessions.map((s) => (
                <button key={s.id} onClick={() => pickDay(s.id)} title={s.topic ?? undefined}
                  style={{ padding: '7px 11px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: 'var(--text-0)',
                    border: s.id === sessionId ? '1.5px solid var(--brand)' : '1px solid var(--glass-hairline)',
                    background: s.id === sessionId ? 'var(--popover-hover)' : 'transparent' }}>
                  {fmtDay(s.sessionDate)}
                  {s.sessionDate.slice(0, 10) === todayBangkok() && <span style={{ color: 'var(--brand)', marginLeft: 5 }}>• {t('case.today')}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {day && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16, alignItems: 'start' }}>
            {/* Cases */}
            <div className="glass rise" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{t('case.cases')} ({day.cases.length})</h2>
                {editing !== 'new' && <button className="btn-primary" onClick={startNew} style={{ padding: '8px 14px', fontSize: 13.5 }}>+ {t('case.assign')}</button>}
              </div>
              <p className="muted" style={{ fontSize: 11.5, margin: '0 0 12px' }}>🔒 {t('case.privacy')}</p>

              {editing && (
                <div className="glass hairline" style={{ padding: 14, borderRadius: 12, marginBottom: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>{t('case.bed')}<input style={input} value={form.bed} onChange={(e) => setForm({ ...form, bed: e.target.value })} /></label>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>HN<input style={input} value={form.hn} onChange={(e) => setForm({ ...form, hn: e.target.value })} /></label>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>{t('case.age')}<input style={input} value={form.patientAge} placeholder={t('case.agePh')} onChange={(e) => setForm({ ...form, patientAge: e.target.value })} /></label>
                  </div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 8 }}>{t('case.patient')}<input style={input} value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })} /></label>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 8 }}>{t('case.diagnosis')}<input style={input} value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></label>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 8 }}>{t('case.caseNote')}<textarea style={{ ...input, minHeight: 54, resize: 'vertical' }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
                  <div style={{ fontSize: 12, fontWeight: 600, margin: '10px 0 6px' }}>{t('case.students')} <span className="muted" style={{ fontWeight: 500 }}>({t('case.pairHint')})</span></div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {day.roster.map((r) => {
                      const on = form.studentIds.includes(r.id);
                      const other = caseOf(r.id);
                      const busyElsewhere = other && other.id !== editing;
                      return (
                        <button key={r.id} type="button" onClick={() => toggleStudent(r.id)}
                          title={busyElsewhere ? `${t('case.alreadyBed')} ${other?.bed ?? ''}` : undefined}
                          style={{ padding: '6px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', color: on ? '#fff' : 'var(--text-0)',
                            border: on ? '1px solid var(--brand)' : '1px solid var(--glass-hairline)', background: on ? 'var(--brand)' : 'transparent',
                            opacity: busyElsewhere && !on ? 0.55 : 1 }}>
                          {r.studentCode} {sname(r)}{busyElsewhere && !on ? ` · ${t('case.bedShort')} ${other?.bed ?? '—'}` : ''}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button className="btn-primary" onClick={saveCase} disabled={busy} style={{ padding: '9px 16px', fontSize: 13.5 }}>{busy ? '…' : t('case.save')}</button>
                    <button onClick={() => setEditing(null)} className="glass hairline" style={{ padding: '9px 14px', fontSize: 13, borderRadius: 10, cursor: 'pointer', color: 'var(--text-1)' }}>{t('case.cancel')}</button>
                  </div>
                </div>
              )}

              {day.cases.length === 0 && !editing && <div className="muted" style={{ fontSize: 13 }}>{t('case.none')}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {day.cases.map((c) => (
                  <div key={c.id} className="glass hairline" style={{ padding: 12, borderRadius: 12, outline: editing === c.id ? '1.5px solid var(--brand)' : undefined }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                          {t('case.bed')} {c.bed || '—'} <span className="muted" style={{ fontWeight: 500, fontSize: 12.5 }}>· HN {c.hn || '—'}</span>
                        </div>
                        <div style={{ fontSize: 13.5, marginTop: 2 }}>{c.patientName || '—'}{c.patientAge ? ` · ${c.patientAge}` : ''}</div>
                        {c.diagnosis && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Dx: {c.diagnosis}</div>}
                        {c.note && <div className="muted" style={{ fontSize: 12.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>{c.note}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => startEdit(c)} className="glass hairline" style={{ padding: '5px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer', color: 'var(--text-1)' }}>{t('case.edit')}</button>
                        <button onClick={() => deleteCase(c.id)} disabled={busy}
                          style={{ padding: '5px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--danger)',
                            background: confirmDelete === c.id ? 'var(--danger)' : 'transparent', color: confirmDelete === c.id ? '#fff' : 'var(--danger)' }}>
                          {confirmDelete === c.id ? t('case.confirmDelete') : t('case.delete')}
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {c.students.map((s) => <span key={s.id} className="chip" style={{ fontSize: 11.5 }}>{s.studentCode} {sname(s)}</span>)}
                    </div>
                  </div>
                ))}
              </div>
              {unassigned.length > 0 && day.cases.length > 0 && (
                <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  {t('case.unassigned')}: {unassigned.map((r) => sname(r)).join(', ')}
                </div>
              )}
            </div>

            {/* Daily notes */}
            <div className="glass rise" style={{ padding: 18 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>{t('case.notes')}</h2>
              <p className="muted" style={{ fontSize: 11.5, margin: '0 0 12px' }}>{t('case.notesHint')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {day.roster.map((r) => {
                  const c = caseOf(r.id);
                  return (
                    <div key={r.id} className="glass hairline" style={{ padding: 12, borderRadius: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 650, fontSize: 13.5 }}><span style={{ fontFamily: 'ui-monospace, monospace' }}>{r.studentCode}</span> {sname(r)}</span>
                        <span className="muted" style={{ fontSize: 12 }}>{c ? `${t('case.bed')} ${c.bed || '—'}` : t('case.noCase')}</span>
                      </div>
                      {r.notes.map((n) => (
                        <div key={n.id} style={{ fontSize: 13, marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--glass-hairline)' }}>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{n.content}</div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {n.authorName} · {new Date(n.createdAt).toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}
                          </div>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <textarea value={drafts[r.id] ?? ''} rows={1} placeholder={t('case.notePh')}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                          style={{ ...input, minHeight: 38, resize: 'vertical', fontSize: 13 }} />
                        <button className="btn-primary" onClick={() => addNote(r.id)} disabled={savingNote === r.id || !(drafts[r.id] ?? '').trim()}
                          style={{ padding: '0 14px', fontSize: 13, flexShrink: 0 }}>{savingNote === r.id ? '…' : t('case.addNote')}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
