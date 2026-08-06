'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Slot {
  id: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  section: { sectionNo: string; subject: { code: string; nameEn: string } };
  room: { roomNumber: string } | null;
  lecturer: { nameEn: string } | null;
}
interface CalEntry {
  id: string; type: string; title: string; startAt: string; endAt: string;
  color: string | null; room: { roomNumber: string } | null;
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const DAY_LABEL: Record<string, string> = { MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri' };
const START_HOUR = 8;
const END_HOUR = 18;
const PX_PER_MIN = 1.1;

const PALETTE = [
  ['#ff8a4c', '#f97316'], ['#6fa3d6', '#4f83c2'], ['#ffb27a', '#ff9e5e'],
  ['#89b4e0', '#6d9fd6'], ['#f4a259', '#e08a2b'],
];
function colorFor(code: string): [string, string] {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length] as [string, string];
}
const EVENT_STYLE: Record<string, { icon: string; color: string }> = {
  EXAM: { icon: '📝', color: '#e2564d' },
  PERSONAL: { icon: '👤', color: '#6fa3d6' },
  ACTIVITY: { icon: '🎉', color: '#ff8a4c' },
  MEETING: { icon: '👥', color: '#a855f7' },
  OTHER: { icon: '📌', color: '#8b97ad' },
};
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Weekday (MONDAY…) + HH:mm of an ISO instant in campus-local (Asia/Bangkok). */
function bkk(iso: string): { weekday: string; time: string } {
  const d = new Date(iso);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'long' }).format(d).toUpperCase();
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return { weekday, time };
}

function weekRange(): { fromISO: string; toISO: string } {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(now.getDate() - dow);
  const nextMon = new Date(monday); nextMon.setDate(monday.getDate() + 7);
  return { fromISO: monday.toISOString(), toISO: nextMon.toISOString() };
}

export default function TimetablePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [events, setEvents] = useState<CalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today0 = new Date().toISOString().slice(0, 10);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'PERSONAL', title: '', location: '', startDate: today0, startTime: '13:00', endDate: today0, endTime: '14:00' });
  const [saving, setSaving] = useState(false);

  const loadEvents = useCallback(async () => {
    const { fromISO, toISO } = weekRange();
    try {
      const d = await apiFetch<{ items: CalEntry[] }>(`/calendar/entries?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`);
      setEvents(d.items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
    apiFetch<{ slots: Slot[] }>('/timetable')
      .then((d) => setSlots(d.slots))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load timetable'))
      .finally(() => setLoading(false));
    void loadEvents();
  }, [router, loadEvents]);

  const byDay = useMemo(() => {
    const map: Record<string, Slot[]> = {};
    for (const d of DAYS) map[d] = [];
    for (const s of slots) if (map[s.dayOfWeek]) map[s.dayOfWeek].push(s);
    return map;
  }, [slots]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, (CalEntry & { _wd: string; _s: string; _e: string })[]> = {};
    for (const d of DAYS) map[d] = [];
    for (const ev of events) {
      const s = bkk(ev.startAt); const e = bkk(ev.endAt);
      if (map[s.weekday]) map[s.weekday].push({ ...ev, _wd: s.weekday, _s: s.time, _e: e.time });
    }
    return map;
  }, [events]);

  async function submitEvent(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const startAt = `${form.startDate}T${form.startTime}:00+07:00`;
      const endAt = `${form.endDate}T${form.endTime}:00+07:00`;
      await apiFetch('/calendar/entries', {
        method: 'POST',
        body: JSON.stringify({ type: form.type, title: form.title, startAt, endAt, location: form.location || undefined }),
      });
      setShowForm(false);
      setForm({ ...form, title: '', location: '' });
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event');
    } finally {
      setSaving(false);
    }
  }

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const gridHeight = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;
  const todayDow = DAYS[(new Date().getDay() + 6) % 7];

  return (
    <div className="app-shell">
      <Sidebar active="Timetable" />
      <div className="app-main">
        <Topbar email={email} />

        <div className="rise" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('tt.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>
              {t('tt.subtitle')} · {slots.length} {t('tt.slots')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Legend />
            <button className="btn-primary" style={{ padding: '10px 16px', fontSize: 14 }} onClick={() => setShowForm((s) => !s)}>
              {showForm ? t('tt.cancel') : t('tt.addEvent')}
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={submitEvent} className="glass rise" style={{ padding: 18, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Row 1: what */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <Field label={t('tt.eventType')}>
                <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="PERSONAL">{t('tt.type.PERSONAL')}</option>
                  <option value="ACTIVITY">{t('tt.type.ACTIVITY')}</option>
                  <option value="MEETING">{t('tt.type.MEETING')}</option>
                  <option value="EXAM">{t('tt.type.EXAM')}</option>
                </select>
              </Field>
              <Field label={t('tt.eventTitle')}><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label={t('tt.location')}><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="—" /></Field>
            </div>
            {/* Row 2: when (start date/time → end date/time) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, alignItems: 'end' }}>
              <Field label={t('tt.startDate')}><input className="input" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} /></Field>
              <Field label={t('tt.startTime')}><input className="input" type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
              <Field label={t('tt.endDate')}><input className="input" type="date" required value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
              <Field label={t('tt.endTime')}><input className="input" type="time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field>
              <button className="btn-primary" type="submit" disabled={saving} style={{ padding: '12px 20px', fontSize: 14 }}>{saving ? t('tt.saving') : t('tt.save')}</button>
            </div>
          </form>
        )}

        {error && <div className="glass" style={{ padding: 16, marginBottom: 16 }}><span className="chip chip-danger">{t('common.error')}</span> <span style={{ marginLeft: 8 }}>{error}</span></div>}

        <div className="glass rise" style={{ padding: 18, overflowX: 'auto' }}>
          {loading ? (
            <div className="muted" style={{ padding: 40, textAlign: 'center' }}>{t('common.loading')}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(5, minmax(120px, 1fr))', gap: 8, minWidth: 720 }}>
              <div />
              {DAYS.map((d) => (
                <div key={d} style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, padding: '4px 0', color: d === todayDow ? 'var(--brand-2)' : 'var(--text-1)' }}>
                  {DAY_LABEL[d]}{d === todayDow && <div className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>{t('tt.today')}</div>}
                </div>
              ))}

              <div style={{ position: 'relative', height: gridHeight }}>
                {hours.map((h) => (
                  <div key={h} style={{ position: 'absolute', top: (h - START_HOUR) * 60 * PX_PER_MIN - 7, right: 8, fontSize: 11.5, color: 'var(--text-2)' }}>
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {DAYS.map((d) => (
                <div key={d} className="hairline" style={{ position: 'relative', height: gridHeight, borderLeft: '1px solid var(--glass-hairline)', background: d === todayDow ? 'var(--glass-hairline)' : 'transparent', borderRadius: 10 }}>
                  {hours.map((h) => (
                    <div key={h} style={{ position: 'absolute', top: (h - START_HOUR) * 60 * PX_PER_MIN, left: 0, right: 0, borderTop: '1px solid var(--glass-hairline)', opacity: 0.5 }} />
                  ))}

                  {/* class slots (solid) */}
                  {byDay[d].map((s) => {
                    const top = (toMin(s.startTime) - START_HOUR * 60) * PX_PER_MIN;
                    const height = (toMin(s.endTime) - toMin(s.startTime)) * PX_PER_MIN;
                    const [c1, c2] = colorFor(s.section.subject.code);
                    return (
                      <div key={s.id} style={{ position: 'absolute', top, height, left: 4, width: 'calc(55% - 6px)', borderRadius: 12, padding: '8px 9px', color: '#fff', background: `linear-gradient(140deg, ${c1}, ${c2})`, boxShadow: '0 6px 16px -6px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, fontSize: 12.5 }}>{s.section.subject.code}</div>
                        <div style={{ fontSize: 10, opacity: 0.95, lineHeight: 1.25, marginTop: 2 }}>{s.section.subject.nameEn}</div>
                        <div style={{ fontSize: 10, opacity: 0.9, marginTop: 3 }}>{s.startTime}–{s.endTime} · {s.room?.roomNumber ?? '—'}</div>
                      </div>
                    );
                  })}

                  {/* calendar events (translucent, right half so they don't hide classes) */}
                  {eventsByDay[d].map((ev) => {
                    const st = EVENT_STYLE[ev.type] ?? EVENT_STYLE.OTHER;
                    const color = ev.color ?? st.color;
                    const top = (toMin(ev._s) - START_HOUR * 60) * PX_PER_MIN;
                    const height = Math.max(28, (toMin(ev._e) - toMin(ev._s)) * PX_PER_MIN);
                    return (
                      <div key={ev.id} title={ev.title} style={{ position: 'absolute', top, height, right: 4, width: 'calc(45% - 6px)', borderRadius: 11, padding: '6px 8px', background: `${color}22`, border: `1px solid ${color}`, borderLeft: `3px solid ${color}`, color: 'var(--text-0)', overflow: 'hidden' }}>
                        <div style={{ fontSize: 12 }}>{st.icon} <span style={{ fontWeight: 700, fontSize: 10.5 }}>{t(`tt.type.${ev.type}`)}</span></div>
                        <div style={{ fontSize: 10.5, lineHeight: 1.25, marginTop: 2, fontWeight: 600 }}>{ev.title}</div>
                        <div className="muted" style={{ fontSize: 9.5, marginTop: 2 }}>{ev._s}–{ev._e}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function Legend() {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11.5 }} className="muted">
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'linear-gradient(140deg,#ff8a4c,#f97316)', verticalAlign: 'middle', marginRight: 4 }} />{t('tt.legendClass')}</span>
        <span>📝 {t('tt.type.EXAM')}</span>
        <span>👤 {t('tt.type.PERSONAL')}</span>
        <span>🎉 {t('tt.type.ACTIVITY')}</span>
      </div>
    );
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="subtle" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
