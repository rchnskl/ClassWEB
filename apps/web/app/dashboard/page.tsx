'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import StatCard from '@/components/StatCard';
import { IconStudents, IconBook, IconCheck, IconCalendar, IconReport } from '@/components/icons';
import { apiFetch, type DashboardSummary, type MeResponse } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem('accessToken')) {
      router.replace('/login');
      return;
    }
    (async () => {
      try {
        const [m, s] = await Promise.all([
          apiFetch<MeResponse>('/users/me'),
          apiFetch<DashboardSummary>('/dashboard/summary'),
        ]);
        setMe(m);
        setSummary(s);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const email = me?.email ?? 'admin@nursing.au.edu';
  const attendanceLabel =
    summary?.attendanceRate != null ? `${summary.attendanceRate.toFixed(1)}%` : '—';

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, maxWidth: 1440, margin: '0 auto' }}>
      <Sidebar active="Dashboard" />

      <div style={{ flex: 1, minWidth: 0 }}>
        <Topbar email={email} />

        <div className="rise" style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>
            {t('dash.greeting')} 👋
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>{t('dash.subtitle')}</p>
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
          {/* Today's classes */}
          <div className="glass rise" style={{ padding: 22, animationDelay: '160ms' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{t('dash.todayClasses')}</h2>
              <span className="chip chip-success">{summary?.todayClasses ?? 0} {t('dash.sessions')}</span>
            </div>
            {(summary?.todayClasses ?? 0) === 0 ? (
              <EmptyState title={t('dash.noClassesTitle')} body={t('dash.noClassesBody')} />
            ) : (
              <p className="muted">{summary?.todayClasses} {t('dash.sessionsToday')}</p>
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
