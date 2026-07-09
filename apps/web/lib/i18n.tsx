'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Lang = 'en' | 'th';

type Dict = Record<string, string>;

const EN: Dict = {
  'brand.tagline': 'Faculty of Nursing · Assumption University',
  'brand.short': 'Nursing · AU',
  'login.welcome': 'Welcome back',
  'login.subtitle': 'Sign in to the classroom platform.',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.signin': 'Sign in',
  'login.signingIn': 'Signing in…',
  'login.footer': 'Protected by JWT · RBAC · audited access',
  'login.apiError': 'Cannot reach the API. Is the backend running on port 3001?',

  'nav.dashboard': 'Dashboard',
  'nav.students': 'Students',
  'nav.lecturers': 'Lecturers',
  'nav.sections': 'Subjects & Sections',
  'nav.timetable': 'Timetable',
  'nav.attendance': 'Attendance',
  'nav.reports': 'Reports',
  'nav.settings': 'Settings',
  'nav.year': 'Academic Year 2026',
  'nav.semester': 'First Semester · active',

  'top.search': 'Search students, sections, rooms…',
  'top.role': 'Administrator',
  'top.logout': 'Log out',

  'dash.greeting': 'Good day',
  'dash.subtitle': 'Here is what is happening across the Faculty of Nursing today.',
  'dash.activeStudents': 'Active students',
  'dash.currentlyStudying': 'Currently studying',
  'dash.sections': 'Sections',
  'dash.thisSemester': 'This semester',
  'dash.enrollments': 'Enrollments',
  'dash.active': 'Active',
  'dash.todayClasses': "Today's classes",
  'dash.scheduledSessions': 'Scheduled sessions',
  'dash.atRisk': 'At-risk students',
  'dash.below80': 'Below 80% attendance',
  'dash.sessions': 'sessions',
  'dash.noClassesTitle': 'No classes scheduled for today',
  'dash.noClassesBody': 'Sessions appear here once the timetable generates class sessions for the current date.',
  'dash.sessionsToday': 'sessions scheduled today.',
  'dash.attendance': 'Attendance',
  'dash.noAttendance': 'No attendance captured yet — begins in the attendance phase.',
  'dash.attendanceAvg': 'Average across active enrollments',
  'dash.signedInAs': 'Signed in as',
  'dash.dataGenerated': 'data generated',

  'students.title': 'Students',
  'students.count': 'student(s) · Faculty of Nursing',
  'students.add': '+ Add student',
  'students.close': 'Close',
  'students.studentId': 'Student ID',
  'students.englishName': 'English name',
  'students.nickname': 'Nickname',
  'students.program': 'Program',
  'students.gender': 'Gender',
  'students.create': 'Create',
  'students.saving': 'Saving…',
  'students.search': 'Search by name, ID or nickname…',
  'students.name': 'Name',
  'students.year': 'Year',
  'students.status': 'Status',
  'students.none': 'No students found',
  'students.noneHint': 'Try a different search, or add a student.',
  'students.select': 'Select…',
  'students.female': 'Female',
  'students.male': 'Male',
  'students.other': 'Other',

  'tt.title': 'Timetable',
  'tt.subtitle': 'Weekly view · First Semester 2026',
  'tt.slots': 'scheduled slots',
  'tt.today': 'today',

  'widget.localTime': 'Local time',
  'widget.weather': 'Weather',
  'widget.airQuality': 'Air quality',
  'widget.feelsLike': 'Feels like',
  'widget.humidity': 'Humidity',
  'widget.wind': 'Wind',
  'widget.aqi': 'US AQI',
  'widget.updated': 'Updated',
  'widget.unavailable': 'Data unavailable',

  'common.loading': 'Loading…',
  'common.error': 'Error',
  'common.page': 'Page',
  'common.of': 'of',
  'common.previous': 'Previous',
  'common.next': 'Next',
};

const TH: Dict = {
  'brand.tagline': 'คณะพยาบาลศาสตร์ · มหาวิทยาลัยอัสสัมชัญ',
  'brand.short': 'พยาบาล · AU',
  'login.welcome': 'ยินดีต้อนรับกลับ',
  'login.subtitle': 'เข้าสู่ระบบแพลตฟอร์มห้องเรียน',
  'login.email': 'อีเมล',
  'login.password': 'รหัสผ่าน',
  'login.signin': 'เข้าสู่ระบบ',
  'login.signingIn': 'กำลังเข้าสู่ระบบ…',
  'login.footer': 'ปลอดภัยด้วย JWT · RBAC · บันทึกการเข้าถึง',
  'login.apiError': 'เชื่อมต่อ API ไม่ได้ ตรวจสอบว่า backend รันที่พอร์ต 3001 หรือไม่',

  'nav.dashboard': 'แดชบอร์ด',
  'nav.students': 'นักศึกษา',
  'nav.lecturers': 'อาจารย์',
  'nav.sections': 'รายวิชาและกลุ่มเรียน',
  'nav.timetable': 'ตารางเรียน',
  'nav.attendance': 'การเช็คชื่อ',
  'nav.reports': 'รายงาน',
  'nav.settings': 'ตั้งค่า',
  'nav.year': 'ปีการศึกษา 2569',
  'nav.semester': 'ภาคเรียนที่ 1 · ใช้งาน',

  'top.search': 'ค้นหานักศึกษา รายวิชา ห้องเรียน…',
  'top.role': 'ผู้ดูแลระบบ',
  'top.logout': 'ออกจากระบบ',

  'dash.greeting': 'สวัสดี',
  'dash.subtitle': 'ภาพรวมของคณะพยาบาลศาสตร์วันนี้',
  'dash.activeStudents': 'นักศึกษาที่กำลังเรียน',
  'dash.currentlyStudying': 'กำลังศึกษา',
  'dash.sections': 'กลุ่มเรียน',
  'dash.thisSemester': 'ภาคเรียนนี้',
  'dash.enrollments': 'การลงทะเบียน',
  'dash.active': 'ใช้งานอยู่',
  'dash.todayClasses': 'คลาสวันนี้',
  'dash.scheduledSessions': 'คาบที่จัดไว้',
  'dash.atRisk': 'นักศึกษากลุ่มเสี่ยง',
  'dash.below80': 'เข้าเรียนต่ำกว่า 80%',
  'dash.sessions': 'คาบ',
  'dash.noClassesTitle': 'ไม่มีคลาสในวันนี้',
  'dash.noClassesBody': 'คาบเรียนจะปรากฏที่นี่เมื่อตารางเรียนสร้างคาบสำหรับวันนี้',
  'dash.sessionsToday': 'คาบที่จัดไว้วันนี้',
  'dash.attendance': 'การเข้าเรียน',
  'dash.noAttendance': 'ยังไม่มีข้อมูลการเช็คชื่อ — เริ่มในเฟสการเช็คชื่อ',
  'dash.attendanceAvg': 'ค่าเฉลี่ยของการลงทะเบียนที่ใช้งานอยู่',
  'dash.signedInAs': 'เข้าสู่ระบบโดย',
  'dash.dataGenerated': 'ข้อมูล ณ',

  'students.title': 'นักศึกษา',
  'students.count': 'คน · คณะพยาบาลศาสตร์',
  'students.add': '+ เพิ่มนักศึกษา',
  'students.close': 'ปิด',
  'students.studentId': 'รหัสนักศึกษา',
  'students.englishName': 'ชื่อ (อังกฤษ)',
  'students.nickname': 'ชื่อเล่น',
  'students.program': 'หลักสูตร',
  'students.gender': 'เพศ',
  'students.create': 'สร้าง',
  'students.saving': 'กำลังบันทึก…',
  'students.search': 'ค้นหาด้วยชื่อ รหัส หรือชื่อเล่น…',
  'students.name': 'ชื่อ',
  'students.year': 'ปีที่เข้า',
  'students.status': 'สถานะ',
  'students.none': 'ไม่พบนักศึกษา',
  'students.noneHint': 'ลองค้นหาใหม่ หรือเพิ่มนักศึกษา',
  'students.select': 'เลือก…',
  'students.female': 'หญิง',
  'students.male': 'ชาย',
  'students.other': 'อื่น ๆ',

  'tt.title': 'ตารางเรียน',
  'tt.subtitle': 'มุมมองรายสัปดาห์ · ภาคเรียนที่ 1 ปีการศึกษา 2569',
  'tt.slots': 'คาบที่จัดไว้',
  'tt.today': 'วันนี้',

  'widget.localTime': 'เวลาท้องถิ่น',
  'widget.weather': 'สภาพอากาศ',
  'widget.airQuality': 'คุณภาพอากาศ',
  'widget.feelsLike': 'รู้สึกเหมือน',
  'widget.humidity': 'ความชื้น',
  'widget.wind': 'ลม',
  'widget.aqi': 'ดัชนี AQI (US)',
  'widget.updated': 'อัปเดตเมื่อ',
  'widget.unavailable': 'ไม่มีข้อมูล',

  'common.loading': 'กำลังโหลด…',
  'common.error': 'ข้อผิดพลาด',
  'common.page': 'หน้า',
  'common.of': 'จาก',
  'common.previous': 'ก่อนหน้า',
  'common.next': 'ถัดไป',
};

const DICTS: Record<Lang, Dict> = { en: EN, th: TH };

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'th',
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('th');

  useEffect(() => {
    const stored = localStorage.getItem('lang') as Lang | null;
    if (stored === 'en' || stored === 'th') setLangState(stored);
    document.documentElement.setAttribute('lang', stored ?? 'th');
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    localStorage.setItem('lang', next);
    document.documentElement.setAttribute('lang', next);
  }, []);

  const t = useCallback((key: string) => DICTS[lang][key] ?? DICTS.en[key] ?? key, [lang]);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
