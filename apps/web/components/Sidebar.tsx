'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Logo from './Logo';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useUI } from '@/lib/ui';
import {
  IconGrid, IconStudents, IconTeacher, IconBook, IconCalendar,
  IconCheck, IconReport, IconSettings, IconGrade,
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
  const { sidebarOpen, setSidebarOpen } = useUI();
  const close = () => setSidebarOpen(false);

  const [currentYear, setCurrentYear] = useState<YearRef | null>(null);
  const [currentSemester, setCurrentSemester] = useState<SemesterRef | null>(null);
  useEffect(() => {
    if (!localStorage.getItem('accessToken')) return;
    apiFetch<YearRef[]>('/academic-years').then((years) => setCurrentYear(years.find((y) => y.isCurrent) ?? null)).catch(() => {});
    apiFetch<SemesterRef[]>('/semesters').then((sems) => setCurrentSemester(sems.find((s) => s.isCurrent) ?? null)).catch(() => {});
  }, []);

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
        width: 250, padding: 18, display: 'flex', flexDirection: 'column', gap: 6,
        position: 'sticky', top: 16, height: 'calc(100vh - 32px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 8px 16px' }}>
        <Logo size={38} float />
        <div>
          <div style={{ fontWeight: 700, fontSize: 16.5, letterSpacing: -0.3 }}>
            Class<span className="brand-text">Web</span>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>{t('brand.short')}</div>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.id} href={item.href} onClick={close} className={`nav-item${item.id === active ? ' active' : ''}`}>
              <Icon />
              <span>{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="glass hairline" style={{ marginTop: 'auto', padding: 14, borderRadius: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{yearLabel}</div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{semLabel}</div>
      </div>
    </aside>
    </>
  );
}
