'use client';

import { useEffect, useMemo, useState } from 'react';
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

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const DAY_LABEL: Record<string, string> = { MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri' };
const START_HOUR = 8;
const END_HOUR = 18;
const PX_PER_MIN = 1.1;

const PALETTE = [
  ['#ff8a4c', '#f97316'], // orange
  ['#6fa3d6', '#4f83c2'], // blue
  ['#ffb27a', '#ff9e5e'], // peach
  ['#89b4e0', '#6d9fd6'], // sky
  ['#f4a259', '#e08a2b'], // amber
];
function colorFor(code: string): [string, string] {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length] as [string, string];
}
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export default function TimetablePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('admin@nursing.au.edu');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) { router.replace('/login'); return; }
    const u = localStorage.getItem('user');
    if (u) { try { setEmail(JSON.parse(u).email); } catch {} }
    apiFetch<{ slots: Slot[] }>('/timetable')
      .then((d) => setSlots(d.slots))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load timetable'))
      .finally(() => setLoading(false));
  }, [router]);

  const byDay = useMemo(() => {
    const map: Record<string, Slot[]> = {};
    for (const d of DAYS) map[d] = [];
    for (const s of slots) if (map[s.dayOfWeek]) map[s.dayOfWeek].push(s);
    return map;
  }, [slots]);

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const gridHeight = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;
  const todayDow = DAYS[(new Date().getDay() + 6) % 7]; // Mon=0-indexed

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, maxWidth: 1440, margin: '0 auto' }}>
      <Sidebar active="Timetable" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Topbar email={email} />

        <div className="rise" style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>{t('tt.title')}</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>
            {t('tt.subtitle')} · {slots.length} {t('tt.slots')}
          </p>
        </div>

        {error && <div className="glass" style={{ padding: 16, marginBottom: 16 }}><span className="chip chip-danger">{t('common.error')}</span> <span style={{ marginLeft: 8 }}>{error}</span></div>}

        <div className="glass rise" style={{ padding: 18, overflowX: 'auto' }}>
          {loading ? (
            <div className="muted" style={{ padding: 40, textAlign: 'center' }}>{t('common.loading')}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(5, minmax(120px, 1fr))', gap: 8, minWidth: 720 }}>
              {/* header */}
              <div />
              {DAYS.map((d) => (
                <div key={d} style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, padding: '4px 0', color: d === todayDow ? 'var(--brand-2)' : 'var(--text-1)' }}>
                  {DAY_LABEL[d]}{d === todayDow && <div className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>{t('tt.today')}</div>}
                </div>
              ))}

              {/* time axis */}
              <div style={{ position: 'relative', height: gridHeight }}>
                {hours.map((h) => (
                  <div key={h} style={{ position: 'absolute', top: (h - START_HOUR) * 60 * PX_PER_MIN - 7, right: 8, fontSize: 11.5, color: 'var(--text-2)' }}>
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {/* day columns */}
              {DAYS.map((d) => (
                <div key={d} className="hairline" style={{ position: 'relative', height: gridHeight, borderLeft: '1px solid var(--glass-hairline)', background: d === todayDow ? 'var(--glass-hairline)' : 'transparent', borderRadius: 10 }}>
                  {hours.map((h) => (
                    <div key={h} style={{ position: 'absolute', top: (h - START_HOUR) * 60 * PX_PER_MIN, left: 0, right: 0, borderTop: '1px solid var(--glass-hairline)', opacity: 0.5 }} />
                  ))}
                  {byDay[d].map((s) => {
                    const top = (toMin(s.startTime) - START_HOUR * 60) * PX_PER_MIN;
                    const height = (toMin(s.endTime) - toMin(s.startTime)) * PX_PER_MIN;
                    const [c1, c2] = colorFor(s.section.subject.code);
                    return (
                      <div key={s.id} style={{ position: 'absolute', top, height, left: 4, right: 4, borderRadius: 12, padding: '8px 10px', color: '#fff', background: `linear-gradient(140deg, ${c1}, ${c2})`, boxShadow: '0 6px 16px -6px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{s.section.subject.code}</div>
                        <div style={{ fontSize: 11, opacity: 0.95, lineHeight: 1.3, marginTop: 2 }}>{s.section.subject.nameEn}</div>
                        <div style={{ fontSize: 10.5, opacity: 0.9, marginTop: 4 }}>{s.startTime}–{s.endTime} · {s.room?.roomNumber ?? '—'}</div>
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
}
