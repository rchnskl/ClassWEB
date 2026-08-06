'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface SessionItem {
  id: string; startTime: string; endTime: string; status: string;
  section: { sectionNo: string; subject: { code: string; nameEn: string } };
  room: { roomNumber: string } | null;
}
interface RosterRow {
  enrollmentId: string; studentId: string; studentCode: string; nameEn: string; nameTh?: string | null;
  record: { status: string; method: string } | null;
}
interface Pending { id: string; enteredCode: string; createdAt: string }
interface State {
  classSession: { id: string; startTime: string; endTime: string; sectionNo: string; subject: { code: string; nameEn: string } };
  open: { token: string; expiresAt: string } | null;
  counts: { enrolled: number; present: number; late: number; absent: number; pending: number };
  roster: RosterRow[];
  pending: Pending[];
}
const REASONS = ['MAKEUP_OTHER_SECTION', 'WRONG_CODE', 'LATE_REGISTRATION', 'OTHER'] as const;

export default function AttendancePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [origin, setOrigin] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const loadState = useCallback(async (id: string) => {
    try { setState(await apiFetch<State>(`/attendance/sessions/${id}`)); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    setOrigin(window.location.origin);
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
    apiFetch<{ items: SessionItem[] }>(`/timetable/sessions?date=${today}`)
      .then((d) => { setSessions(d.items); if (d.items[0]) { setSelected(d.items[0].id); void loadState(d.items[0].id); } })
      .catch(() => {});
  }, [router, today, loadState]);

  // Poll while a session is selected (catch live QR check-ins).
  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => void loadState(selected), 4000);
    return () => clearInterval(id);
  }, [selected, loadState]);

  async function open() {
    if (!selected) return;
    setActionError(null);
    try {
      await apiFetch(`/attendance/sessions/${selected}/open`, { method: 'POST' });
      await loadState(selected);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to open the attendance window.');
    }
  }
  async function mark(studentId: string, status: string) {
    if (!selected) return;
    setActionError(null);
    try {
      await apiFetch('/attendance/records', { method: 'POST', body: JSON.stringify({ classSessionId: selected, studentId, status }) });
      await loadState(selected);
    } catch (err) {
      // A silently-failed mark makes the teacher think attendance was recorded when it wasn't.
      setActionError(err instanceof Error ? err.message : 'Failed to record attendance. Please try again.');
    }
  }
  async function resolve(id: string, action: 'ACCEPT' | 'REJECT', reason: string) {
    setActionError(null);
    try {
      await apiFetch(`/attendance/checkins/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action, reason }) });
      if (selected) await loadState(selected);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to resolve the check-in.');
    }
  }

  function pickSession(id: string) { setSelected(id); void loadState(id); }

  return (
    <div className="app-shell">
      <Sidebar active="Attendance" />
      <div className="app-main">
        <Topbar email={email} />

        {actionError && (
          <div className="chip chip-danger" role="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', marginBottom: 12 }}>
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} aria-label={t('common.close')} className="icon-btn" style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
        )}

        <div className="rise" style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('att.title')}</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('att.subtitle')}</p>
        </div>

        {sessions.length === 0 ? (
          <div className="glass rise" style={{ padding: 40, textAlign: 'center' }} >
            <div className="muted">{t('att.noSessions')}</div>
          </div>
        ) : (
          <>
            {/* Session picker */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              {sessions.map((s) => (
                <button key={s.id} onClick={() => pickSession(s.id)}
                  className={`glass ${s.id === selected ? '' : 'hairline'}`}
                  style={{ padding: '10px 16px', borderRadius: 14, cursor: 'pointer', textAlign: 'left', border: s.id === selected ? '1.5px solid var(--brand)' : undefined }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{s.section.subject.code} · {s.startTime}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{s.section.subject.nameEn}</div>
                </button>
              ))}
            </div>

            {state && (
              <div className="grid-sidebar">
                {/* QR / open panel */}
                <div className="glass rise" style={{ padding: 22, textAlign: 'center', position: 'sticky', top: 16 }}>
                  {state.open ? (
                    <>
                      <span className="chip chip-success" style={{ marginBottom: 14 }}>● {t('att.live')}</span>
                      <div style={{ background: '#fff', padding: 14, borderRadius: 18, display: 'inline-block' }}>
                        <QRCodeSVG value={`${origin}/checkin/${state.open.token}`} size={190} level="M" />
                      </div>
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>{t('att.scan')}</div>
                      <a href={`/checkin/${state.open.token}`} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 11, display: 'block', marginTop: 6, textDecoration: 'underline' }}>
                        {t('att.orLink')}
                      </a>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 40, marginBottom: 10 }}>📷</div>
                      <button className="btn-primary" onClick={open} style={{ padding: '12px 20px', fontSize: 15 }}>{t('att.open')}</button>
                    </>
                  )}

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
                    <Count label={t('att.enrolled')} value={state.counts.enrolled} />
                    <Count label={t('att.present')} value={state.counts.present} tone="var(--success)" />
                    <Count label={t('att.late')} value={state.counts.late} tone="var(--warning)" />
                    <Count label={t('att.absent')} value={state.counts.absent} tone="var(--danger)" />
                  </div>
                </div>

                {/* Roster + pending */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {state.pending.length > 0 && (
                    <div className="glass rise" style={{ padding: 18, borderLeft: '3px solid var(--warning)' }}>
                      <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: '0 0 12px' }}>⚠️ {t('att.pending')} ({state.pending.length})</h2>
                      {state.pending.map((p) => (
                        <PendingRow key={p.id} code={p.enteredCode} t={t} onResolve={(action, reason) => resolve(p.id, action, reason)} />
                      ))}
                    </div>
                  )}

                  <div className="glass rise" style={{ padding: 18 }}>
                    <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: '0 0 12px' }}>{t('att.roster')}</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {state.roster.map((r) => (
                        <div key={r.enrollmentId} className="glass hairline" style={{ padding: '10px 14px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: 13 }}>{r.studentCode}</span>
                          <span style={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 120 }}>{r.nameEn}</span>
                          {r.record && <StatusBadge status={r.record.status} method={r.record.method} t={t} />}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <MarkBtn active={r.record?.status === 'PRESENT'} tone="var(--success)" onClick={() => mark(r.studentId, 'PRESENT')}>{t('att.present')}</MarkBtn>
                            <MarkBtn active={r.record?.status === 'LATE'} tone="var(--warning)" onClick={() => mark(r.studentId, 'LATE')}>{t('att.late')}</MarkBtn>
                            <MarkBtn active={r.record?.status === 'ABSENT'} tone="var(--danger)" onClick={() => mark(r.studentId, 'ABSENT')}>{t('att.absent')}</MarkBtn>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 56 }}>
      <div style={{ fontSize: 22, fontWeight: 750, color: tone ?? 'var(--text-0)' }}>{value}</div>
      <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
    </div>
  );
}
function MarkBtn({ children, onClick, active, tone }: { children: React.ReactNode; onClick: () => void; active?: boolean; tone: string }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 10px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${active ? tone : 'var(--glass-hairline)'}`,
      background: active ? tone : 'transparent', color: active ? '#fff' : 'var(--text-1)', transition: 'all .15s',
    }}>{children}</button>
  );
}
function StatusBadge({ status, method, t }: { status: string; method: string; t: (k: string) => string }) {
  const map: Record<string, string> = { PRESENT: 'chip-success', LATE: 'chip-warning', ABSENT: 'chip-danger' };
  const label: Record<string, string> = { PRESENT: t('att.present'), LATE: t('att.late'), ABSENT: t('att.absent') };
  return <span className={`chip ${map[status] ?? ''}`}>{label[status] ?? status} {method === 'QR_CODE' ? '· QR' : ''}</span>;
}
function PendingRow({ code, onResolve, t }: { code: string; onResolve: (a: 'ACCEPT' | 'REJECT', reason: string) => void; t: (k: string) => string }) {
  const [reason, setReason] = useState<string>('WRONG_CODE');
  return (
    <div className="glass hairline" style={{ padding: '10px 14px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 14 }}>{code}</span>
      <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 160, padding: '7px 10px', fontSize: 13 }}>
        {REASONS.map((r) => <option key={r} value={r}>{t(`att.reason.${r}`)}</option>)}
      </select>
      <button onClick={() => onResolve('ACCEPT', reason)} className="chip chip-success" style={{ cursor: 'pointer', border: 'none', padding: '7px 12px' }}>{t('att.accept')}</button>
      <button onClick={() => onResolve('REJECT', reason)} className="chip chip-danger" style={{ cursor: 'pointer', border: 'none', padding: '7px 12px' }}>{t('att.reject')}</button>
    </div>
  );
}
