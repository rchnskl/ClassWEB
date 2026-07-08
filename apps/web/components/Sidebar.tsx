'use client';

import Logo from './Logo';
import {
  IconGrid, IconStudents, IconTeacher, IconBook, IconCalendar,
  IconCheck, IconReport, IconSettings,
} from './icons';

const NAV = [
  { label: 'Dashboard', icon: IconGrid, active: true },
  { label: 'Students', icon: IconStudents },
  { label: 'Lecturers', icon: IconTeacher },
  { label: 'Subjects & Sections', icon: IconBook },
  { label: 'Timetable', icon: IconCalendar },
  { label: 'Attendance', icon: IconCheck },
  { label: 'Reports', icon: IconReport },
  { label: 'Settings', icon: IconSettings },
];

export default function Sidebar() {
  return (
    <aside
      className="glass"
      style={{
        width: 250,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        position: 'sticky',
        top: 16,
        height: 'calc(100vh - 32px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 8px 16px' }}>
        <Logo size={38} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 16.5, letterSpacing: -0.3 }}>
            Class<span className="brand-text">Web</span>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>Nursing · AU</div>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className={`nav-item${item.active ? ' active' : ''}`}>
              <Icon />
              <span>{item.label}</span>
            </div>
          );
        })}
      </nav>

      <div className="glass hairline" style={{ marginTop: 'auto', padding: 14, borderRadius: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Academic Year 2026</div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>First Semester · active</div>
      </div>
    </aside>
  );
}
