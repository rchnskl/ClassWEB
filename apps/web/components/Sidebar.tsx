'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Logo from './Logo';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useUI } from '@/lib/ui';
import {
  IconGrid, IconStudents, IconTeacher, IconBook, IconCalendar,
  IconCheck, IconReport, IconSettings, IconGrade, IconChevronLeft,
} from './icons';

interface YearRef { id: string; code: string; nameEn: string; nameTh: string | null; isCurrent: boolean }
interface SemesterRef { id: string; type: string; nameEn: string; nameTh: string | null; isCurrent: boolean; academicYear: { id: string; code: string } }

const SEM_LABEL: Record<string, { en: string; th: string }> = {
  FIRST: { en: 'Semester 1', th: 'ภาคเรียนที่ 1' },
  SECOND: { en: 'Semester 2', th: 'ภาคเรียนที่ 2' },
  SUMMER: { en: 'Summer', th: 'ภาคฤดูร้อน' },
  SPECIAL: { en: 'Special', th: 'ภาคพิเศษ' },
};

const NAV = [
  { key: 'nav.dashboard', icon: IconGrid, href: '/dashboard', id: 'Dashboard' },
  { key: 'nav.students', icon: IconStudents, href: '/students', id: 'Students' },
  { key: 'nav.lecturers', icon: IconTeacher, href: '/lecturers', id: 'Lecturers' },
  { key: 'nav.sections', icon: IconBook, href: '/sections', id: 'Sections' },
  { key: 'nav.timetable', icon: IconCalendar, href: '/timetable', id: 'Timetable' },
  { key: 'nav.attendance', icon: IconCheck, href: '/attendance', id: 'Attendance' },
  { key: 'nav.assessment', icon: IconGrade, href: '/assessment', id: 'Assessment' },
  { key: 'nav.reports', icon: IconReport, href: '/reports', id: 'Reports' },
  { key: 'nav.settings', icon: IconSettings, href: '/settings', id: 'Settings' },
];

export default function Sidebar({ active = 'Dashboard' }: { active?: string }) {
  const { t, lang } = useI18n();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed } = useUI();
  const close = () => setSidebarOpen(false);

  const [currentYear, setCurrentYear] = useState<YearRef | null>(null);
  const [currentSemester, setCurrentSemester] = useState<SemesterRef | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem('accessToken')) return;
    apiFetch<YearRef[]>('/academic-years').then((years) => setCurrentYear(years.find((y) => y.isCurrent) ?? null)).catch(() => {});
    apiFetch<SemesterRef[]>('/semesters').then((sems) => setCurrentSemester(sems.find((s) => s.isCurrent) ?? null)).catch(() => {});
    const u = localStorage.getItem('user');
    if (u) { try { setIsAdmin((JSON.parse(u).roleCodes ?? []).includes('ADMIN')); } catch {} }
  }, []);

  const nav = NAV.filter((item) => item.id !== 'Settings' || isAdmin);

  const yearLabel = currentYear ? `${t('nav.yearPrefix')} ${currentYear.code}` : t('nav.year');
  const semLabel = currentSemester
    ? `${lang === 'th' ? SEM_LABEL[currentSemester.type]?.th ?? currentSemester.nameEn : SEM_LABEL[currentSemester.type]?.en ?? currentSemester.nameEn} · ${t('nav.semesterActive')}`
    : t('nav.semester');
  return (
    <>
    <div className={`sidebar-backdrop${sidebarOpen ? ' open' : ''}`} onClick={close} />
    <aside
      className={`glass app-sidebar${sidebarOpen ? ' open' : ''}`}
      style={{
        width: sidebarCollapsed ? 76 : 250, padding: 18, display: 'flex', flexDirection: 'column', gap: 6,
        position: 'sticky', top: 16, height: 'calc(100vh - 32px)',
        transition: 'width 0.22s cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 8px 16px', justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
        <Logo size={38} float />
        {!sidebarCollapsed && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16.5, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>
              Class<span className="brand-text">Web</span>
            </div>
            <div className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{t('brand.short')}</div>
          </div>
        )}
      </div>

      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="glass hairline icon-btn hide-mobile"
        title={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
        style={{ width: 26, height: 26, borderRadius: '50%', alignSelf: sidebarCollapsed ? 'center' : 'flex-end', marginBottom: 6 }}
      >
        <IconChevronLeft width={15} height={15} style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s ease' }} />
      </button>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.id} href={item.href} onClick={close} title={sidebarCollapsed ? t(item.key) : undefined}
              className={`nav-item${item.id === active ? ' active' : ''}`}
              style={sidebarCollapsed ? { justifyContent: 'center' } : undefined}>
              <Icon />
              {!sidebarCollapsed && <span>{t(item.key)}</span>}
            </Link>
          );
        })}
      </nav>

      {!sidebarCollapsed && (
        <div className="glass hairline" style={{ marginTop: 'auto', padding: 14, borderRadius: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{yearLabel}</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{semLabel}</div>
        </div>
      )}
    </aside>
    </>
  );
}
