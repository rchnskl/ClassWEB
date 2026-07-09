'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import StatCard from '@/components/StatCard';
import { IconStudents, IconBook, IconCheck, IconCalendar, IconReport } from '@/components/icons';
import { ClockWidget, EnvironmentWidgets } from '@/components/DashboardWidgets';
import { apiFetch, type DashboardSummary, type MeResponse } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface AgendaItem { key: string; time: string; end: string; title: string; sub: string; kind: string; }

const EVENT_ICON: Record<string, string> = {
  CLASS: '📘', EXAM: '📝', PERSONAL: '👤', ACTIVITY: '🎉', MEETING: '👥', OTHER: '📌',
};

function bkkTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export default function DashboardPage() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) {
      router.replace('/login');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const dayStart = `${today}T00:00:00+07:00`;
    const dayEnd = `${today}T23:59:59+07:00`;
    (async () => {
      try {
        const [m, s, sessions, events] = await Promise.all([
          apiFetch<MeResponse>('/users/me'),
          apiFetch<DashboardSummary>('/dashboard/summary'),
          apiFetch<{ items: { id: string; startTime: string; endTime: string; section: { sectionNo: string; subject: { code: string; nameEn: string } }; room: { roomNumber: string } | null }[] }>(`/timetable/sessions?date=${today}`).catch(() => ({ items: [] })),
          apiFetch<{ items: { id: string; type: string; title: string; startAt: string; endAt: string; location: string | null; room: { roomNumber: string } | null }[] }>(`/calendar/entries?from=${encodeURIComponent(dayStart)}&to=${encodeURIComponent(dayEnd)}`).catch(() => ({ items: [] })),
        ]);
        setMe(m);
        setSummary(s);
        const items: AgendaItem[] = [
          ...sessions.items.map((c) => ({ key: `c${c.id}`, time: c.startTime, end: c.endTime, title: `${c.section.subject.code} · ${c.section.subject.nameEn}`, sub: c.room?.roomNumber ?? '', kind: 'CLASS' })),
          ...events.items.map((e) => ({ key: `e${e.id}`, time: bkkTime(e.startAt), end: bkkTime(e.endAt), title: e.title, sub: e.location ?? e.room?.roomNumber ?? '', kind: e.type })),
        ].sort((a, b) => a.time.localeCompare(b.time));
        setAgenda(items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const email = me?.email ?? 'admin@nursing.au.edu';
  const displayName = me
    ? (lang === 'th' ? me.lecturer?.nameTh ?? me.student?.nameTh : null) ??
      me.lecturer?.nameEn ?? me.student?.nameEn ??
      (lang === 'th' ? me.roles?.[0]?.role.nameTh : null) ?? me.roles?.[0]?.role.nameEn ??
      email.split('@')[0]
    : '';
  const attendanceLabel =
    summary?.attendanceRate != null ? `${summary.attendanceRate.toFixed(1)}%` : '—';

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, maxWidth: 1440, margin: '0 auto' }}>
      <Sidebar active="Dashboard" />

      <div style={{ flex: 1, minWidth: 0 }}>
        <Topbar email={email} />

        <div className="rise" style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>
            {t('dash.greeting')} 👋{displayName ? ` ${displayName}` : ''}
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('dash.subtitle')}</p>
        </div>

        {/* Live widgets: clock (realtime, localised), weather, air quality. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <ClockWidget />
          <EnvironmentWidgets />
        </div>

        {error && (
          <div className="glass" style={{ padding: 16, marginBottom: 20 }}>
            <span className="chip chip-danger">{t('common.error')}</span>
            <span style={{ marginLeft: 10 }}>{error}</span>
          </div>
        )}

        {/* KPI cards — all values are live from the API. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatCard label={t('dash.activeStudents')} value={loading ? '…' : summary?.students ?? 0} icon={<IconStudents />} hint={t('dash.currentlyStudying')} delay={0} />
          <StatCard label={t('dash.sections')} value={loading ? '…' : summary?.sections ?? 0} icon={<IconBook />} hint={t('dash.thisSemester')} tone="blue" delay={60} />
          <StatCard label={t('dash.enrollments')} value={loading ? '…' : summary?.enrollments ?? 0} icon={<IconCheck />} hint={t('dash.active')} tone="success" delay={120} />
          <StatCard label={t('dash.todayClasses')} value={loading ? '…' : summary?.todayClasses ?? 0} icon={<IconCalendar />} hint={t('dash.scheduledSessions')} tone="blue" delay={180} />
          <StatCard label={t('dash.atRisk')} value={loading ? '…' : summary?.atRiskStudents ?? 0} icon={<IconReport />} hint={t('dash.below80')} tone="danger" delay={240} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
          {/* Today's agenda — a to-do list pulled from the timetable + calendar */}
          <div className="glass rise" style={{ padding: 22, animationDelay: '160ms' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>🗓️ {t('dash.agenda')}</h2>
              <a href="/timetable" className="muted" style={{ fontSize: 12.5, textDecoration: 'none', color: 'var(--brand)' }}>{t('dash.viewTimetable')}</a>
            </div>
            {agenda.length === 0 ? (
              <EmptyState title={t('dash.agendaEmpty')} body={t('dash.noClassesBody')} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {agenda.map((it) => (
                  <div key={it.key} className="glass hairline" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12 }}>
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, fontWeight: 700, color: 'var(--brand)', minWidth: 82 }}>{it.time}–{it.end}</div>
                    <div style={{ fontSize: 18 }}>{EVENT_ICON[it.kind] ?? '📌'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                      {it.sub && <div className="muted" style={{ fontSize: 11.5 }}>{it.sub}</div>}
                    </div>
                    <span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-2)', fontSize: 10.5 }}>{t(`tt.type.${it.kind}`)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attendance overview */}
          <div className="glass rise" style={{ padding: 22, animationDelay: '220ms' }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 16px' }}>{t('dash.attendance')}</h2>
            <div style={{ display: 'grid', placeItems: 'center', padding: '8px 0 4px' }}>
              <AttendanceRing value={summary?.attendanceRate ?? null} label={attendanceLabel} />
            </div>
            <div className="muted" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 12 }}>
              {summary?.attendanceRate == null ? t('dash.noAttendance') : t('dash.attendanceAvg')}
            </div>
          </div>
        </div>

        <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 22 }}>
          {me ? `${t('dash.signedInAs')} ${email} · ${me.roles.map((r) => r.role.nameEn).join(', ')}` : ''}
          {summary ? ` · ${t('dash.dataGenerated')} ${new Date(summary.generatedAt).toLocaleTimeString()}` : ''}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: '26px 8px', textAlign: 'center' }}>
      <div className="brand-gradient floaty" style={{ width: 46, height: 46, borderRadius: 14, margin: '0 auto 12px', display: 'grid', placeItems: 'center', opacity: 0.95 }}>
        <IconCalendar width={22} height={22} />
      </div>
      <div style={{ fontWeight: 650, fontSize: 15 }}>{title}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 340, margin: '6px auto 0' }}>{body}</div>
    </div>
  );
}

function AttendanceRing({ value, label }: { value: number | null; label: string }) {
  const pct = value ?? 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <svg width={140} height={140} viewBox="0 0 140 140">
      <defs>
        <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff8a4c" />
          <stop offset="100%" stopColor="#6fa3d6" />
        </linearGradient>
      </defs>
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--glass-hairline)" strokeWidth="14" />
      <circle
        cx="70" cy="70" r={r} fill="none" stroke="url(#ring)" strokeWidth="14" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={value == null ? c : offset}
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="70" textAnchor="middle" dominantBaseline="central" fontSize="24" fontWeight="750" fill="var(--text-0)">
        {label}
      </text>
    </svg>
  );
}
