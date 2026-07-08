'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import StatCard from '@/components/StatCard';
import { IconStudents, IconBook, IconCheck, IconCalendar, IconTeacher, IconReport } from '@/components/icons';
import { apiFetch, type DashboardSummary, type MeResponse } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
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
      <Sidebar />

      <div style={{ flex: 1, minWidth: 0 }}>
        <Topbar email={email} />

        <div className="rise" style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.6, margin: 0 }}>
            Good day 👋
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>
            Here is what is happening across the Faculty of Nursing today.
          </p>
        </div>

        {error && (
          <div className="glass" style={{ padding: 16, marginBottom: 20 }}>
            <span className="chip chip-danger">Error</span>
            <span style={{ marginLeft: 10 }}>{error}</span>
          </div>
        )}

        {/* KPI cards — all values are live from the API. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatCard label="Active students" value={loading ? '…' : summary?.students ?? 0} icon={<IconStudents />} hint="Currently studying" delay={0} />
          <StatCard label="Sections" value={loading ? '…' : summary?.sections ?? 0} icon={<IconBook />} hint="This semester" delay={60} />
          <StatCard label="Enrollments" value={loading ? '…' : summary?.enrollments ?? 0} icon={<IconCheck />} hint="Active" tone="success" delay={120} />
          <StatCard label="Today’s classes" value={loading ? '…' : summary?.todayClasses ?? 0} icon={<IconCalendar />} hint="Scheduled sessions" delay={180} />
          <StatCard label="At-risk students" value={loading ? '…' : summary?.atRiskStudents ?? 0} icon={<IconReport />} hint="Below 80% attendance" tone="danger" delay={240} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
          {/* Today's classes */}
          <div className="glass rise" style={{ padding: 22, animationDelay: '160ms' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Today’s classes</h2>
              <span className="chip chip-success">{summary?.todayClasses ?? 0} sessions</span>
            </div>
            {(summary?.todayClasses ?? 0) === 0 ? (
              <EmptyState
                title="No classes scheduled for today"
                body="Sessions appear here once the timetable (Phase 4) generates class sessions for the current date."
              />
            ) : (
              <p className="muted">{summary?.todayClasses} sessions scheduled today.</p>
            )}
          </div>

          {/* Attendance overview */}
          <div className="glass rise" style={{ padding: 22, animationDelay: '220ms' }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 16px' }}>Attendance</h2>
            <div style={{ display: 'grid', placeItems: 'center', padding: '8px 0 4px' }}>
              <AttendanceRing value={summary?.attendanceRate ?? null} label={attendanceLabel} />
            </div>
            <div className="muted" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 12 }}>
              {summary?.attendanceRate == null
                ? 'No attendance captured yet — begins in Phase 4.'
                : 'Average across active enrollments'}
            </div>
          </div>
        </div>

        <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 22 }}>
          {me ? `Signed in as ${email} · ${me.roles.map((r) => r.role.nameEn).join(', ')}` : ''}
          {summary ? ` · data generated ${new Date(summary.generatedAt).toLocaleTimeString()}` : ''}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: '26px 8px', textAlign: 'center' }}>
      <div className="brand-gradient" style={{ width: 46, height: 46, borderRadius: 14, margin: '0 auto 12px', display: 'grid', placeItems: 'center', opacity: 0.9 }}>
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
          <stop offset="0%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#6366f1" />
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
