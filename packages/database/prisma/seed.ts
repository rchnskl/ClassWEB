/**
 * Seed for the initial tenant: Assumption University → Faculty of Nursing.
 *
 * Idempotent: every write is an upsert keyed on a natural unique constraint,
 * so it is safe to run repeatedly (CI, local resets, staging refresh).
 *
 * Run:  npm run db:seed   (from repo root)
 */
import { PrismaClient, SemesterType, DayOfWeek, Gender } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { RUBRICS, GRADE_BANDS } from './rubrics.data';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// RBAC: the permission matrix. Resource:action pairs granted to each role.
// ---------------------------------------------------------------------------
const RESOURCES = [
  'university', 'faculty', 'program', 'course', 'subject', 'section', 'department',
  'academicYear', 'semester', 'room', 'building',
  'student', 'lecturer', 'enrollment', 'attendance', 'timetable',
  'note', 'assessment', 'report', 'notification', 'setting', 'audit', 'backup', 'user', 'role',
];
const ACTIONS = ['create', 'read', 'update', 'delete', 'export'] as const;

const ROLE_MATRIX: Record<string, (resource: string, action: string) => boolean> = {
  // Faculty admin — full control of the tenant.
  ADMIN: () => true,
  // Lecturer — manage their teaching + attendance, read academic data. Can add
  // their own sections and manage that section's roster, but not curriculum
  // (subjects/courses/departments) or other lecturers' sections.
  LECTURER: (r, a) => {
    if (['attendance', 'timetable', 'note', 'assessment'].includes(r)) return true;
    if (r === 'report' && ['read', 'export'].includes(a)) return true;
    if (r === 'section' && ['read', 'create', 'update'].includes(a)) return true;
    if (r === 'enrollment' && ['read', 'create', 'update'].includes(a)) return true;
    if (['student', 'lecturer', 'subject', 'course', 'room', 'department'].includes(r) && a === 'read') return true;
    return false;
  },
  // Student — read their own academic surface only.
  STUDENT: (r, a) =>
    a === 'read' && ['section', 'subject', 'timetable', 'attendance', 'enrollment'].includes(r),
};

async function main() {
  console.log('🌱 Seeding Assumption University / Faculty of Nursing…');

  // ---- Permissions --------------------------------------------------------
  const permissions = RESOURCES.flatMap((resource) =>
    ACTIONS.map((action) => ({ code: `${resource}:${action}`, resource, action })),
  );
  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
  }
  const allPerms = await prisma.permission.findMany();
  console.log(`  ✓ ${allPerms.length} permissions`);

  // ---- University (tenant root) ------------------------------------------
  const university = await prisma.university.upsert({
    where: { code: 'AU' },
    update: {},
    create: {
      code: 'AU',
      nameEn: 'Assumption University',
      nameTh: 'มหาวิทยาลัยอัสสัมชัญ',
      shortName: 'AU',
      websiteUrl: 'https://www.au.edu',
    },
  });

  // ---- Roles + role→permission grants ------------------------------------
  const roleDefs = [
    { code: 'ADMIN', nameEn: 'Faculty Administrator', nameTh: 'ผู้ดูแลระบบคณะ' },
    { code: 'LECTURER', nameEn: 'Lecturer', nameTh: 'อาจารย์' },
    { code: 'STUDENT', nameEn: 'Student', nameTh: 'นักศึกษา' },
  ];
  const roles: Record<string, string> = {};
  for (const def of roleDefs) {
    const role = await prisma.role.upsert({
      where: { universityId_code: { universityId: university.id, code: def.code } },
      update: {},
      create: { universityId: university.id, isSystem: true, ...def },
    });
    roles[def.code] = role.id;
    const grants = allPerms.filter((p) => ROLE_MATRIX[def.code](p.resource, p.action));
    for (const perm of grants) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
    console.log(`  ✓ role ${def.code}: ${grants.length} permissions`);
  }

  // ---- Admin user ---------------------------------------------------------
  const adminEmail = 'admin@nursing.au.edu';
  const passwordHash = await bcrypt.hash('ChangeMe!2026', 12);
  const admin = await prisma.user.upsert({
    where: { universityId_email: { universityId: university.id, email: adminEmail } },
    update: {},
    create: { universityId: university.id, email: adminEmail, passwordHash, status: 'ACTIVE' },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roles.ADMIN } },
    update: {},
    create: { userId: admin.id, roleId: roles.ADMIN },
  });
  console.log(`  ✓ admin user ${adminEmail} (password: ChangeMe!2026 — rotate on first login)`);

  // ---- Campus / Building / Rooms -----------------------------------------
  const campus = await prisma.campus.upsert({
    where: { universityId_code: { universityId: university.id, code: 'SUVARNABHUMI' } },
    update: {},
    create: {
      universityId: university.id, code: 'SUVARNABHUMI',
      nameEn: 'Suvarnabhumi Campus', nameTh: 'วิทยาเขตสุวรรณภูมิ', city: 'Samut Prakan',
    },
  });
  const building = await prisma.building.upsert({
    where: { campusId_code: { campusId: campus.id, code: 'CL' } },
    update: {},
    create: { campusId: campus.id, code: 'CL', nameEn: 'Cathedral of Learning', floors: 12 },
  });
  const roomDefs = [
    { roomNumber: 'CL-1101', floor: 11, capacity: 60, equipment: ['projector', 'whiteboard'] },
    { roomNumber: 'CL-1102', floor: 11, capacity: 40, equipment: ['projector'] },
    { roomNumber: 'NLAB-01', floor: 3, capacity: 30, equipment: ['manikin', 'hospital-bed', 'projector'] },
  ];
  const rooms: Record<string, string> = {};
  for (const r of roomDefs) {
    const room = await prisma.room.upsert({
      where: { buildingId_roomNumber: { buildingId: building.id, roomNumber: r.roomNumber } },
      update: {},
      create: { buildingId: building.id, ...r },
    });
    rooms[r.roomNumber] = room.id;
  }
  console.log(`  ✓ campus + building + ${roomDefs.length} rooms`);

  // ---- Faculty / Department / Program ------------------------------------
  const faculty = await prisma.faculty.upsert({
    where: { universityId_code: { universityId: university.id, code: 'NURSING' } },
    update: {},
    create: {
      universityId: university.id, code: 'NURSING',
      nameEn: 'Faculty of Nursing', nameTh: 'คณะพยาบาลศาสตร์',
    },
  });
  const department = await prisma.department.upsert({
    where: { facultyId_code: { facultyId: faculty.id, code: 'ADULT' } },
    update: {},
    create: { facultyId: faculty.id, code: 'ADULT', nameEn: 'Adult & Gerontological Nursing' },
  });
  const program = await prisma.program.upsert({
    where: { facultyId_code: { facultyId: faculty.id, code: 'BNS' } },
    update: {},
    create: {
      facultyId: faculty.id, code: 'BNS',
      nameEn: 'Bachelor of Nursing Science', nameTh: 'พยาบาลศาสตรบัณฑิต',
      degreeType: 'Bachelor', durationYrs: 4, totalCredits: 138,
    },
  });
  console.log('  ✓ faculty + department + program');

  // ---- Academic year + semesters -----------------------------------------
  const academicYear = await prisma.academicYear.upsert({
    where: { universityId_code: { universityId: university.id, code: '2026' } },
    update: {},
    create: {
      universityId: university.id, code: '2026', nameEn: 'Academic Year 2026',
      startDate: new Date('2026-06-01'), endDate: new Date('2027-05-31'), isCurrent: true,
    },
  });
  const semester = await prisma.semester.upsert({
    where: { academicYearId_type: { academicYearId: academicYear.id, type: SemesterType.FIRST } },
    update: {},
    create: {
      academicYearId: academicYear.id, type: SemesterType.FIRST, nameEn: 'First Semester',
      startDate: new Date('2026-06-01'), endDate: new Date('2026-10-15'),
      addDropDeadline: new Date('2026-06-15'), isCurrent: true,
    },
  });
  console.log('  ✓ academic year 2026 + first semester');

  // ---- Default attendance rule -------------------------------------------
  const existingRule = await prisma.attendanceRule.findFirst({
    where: { universityId: university.id, scope: 'UNIVERSITY', sectionId: null },
  });
  if (!existingRule) {
    await prisma.attendanceRule.create({
      data: {
        universityId: university.id, scope: 'UNIVERSITY',
        name: 'Faculty of Nursing default policy',
        lateAfterMinutes: 15, autoAbsentAfterMinutes: 60, lockAfterMinutes: 120,
        attendanceWeight: 10, warningThreshold: 80, riskThreshold: 70, criticalThreshold: 60,
      },
    });
  }
  console.log('  ✓ default attendance rule');

  // ---- Settings -----------------------------------------------------------
  const settings: Array<{ key: string; value: any }> = [
    { key: 'theme.primaryColor', value: '#0E7C7B' },
    { key: 'theme.mode', value: 'system' },
    { key: 'system.name', value: 'ClassWeb — Faculty of Nursing' },
    { key: 'pdf.header', value: 'Faculty of Nursing, Assumption University' },
    { key: 'pdf.footer', value: 'Generated by ClassWeb • Official document' },
  ];
  for (const s of settings) {
    await prisma.setting.upsert({
      where: {
        universityId_scope_scopeId_key: {
          universityId: university.id, scope: 'UNIVERSITY', scopeId: '', key: s.key,
        },
      },
      update: { value: s.value },
      create: { universityId: university.id, scope: 'UNIVERSITY', scopeId: '', key: s.key, value: s.value },
    });
  }
  console.log(`  ✓ ${settings.length} settings`);

  // ---- Course / Subjects --------------------------------------------------
  const course = await prisma.course.upsert({
    where: { programId_code: { programId: program.id, code: 'NUR-FND' } },
    update: {},
    create: { programId: program.id, code: 'NUR-FND', nameEn: 'Foundations of Nursing' },
  });
  const subjectDefs = [
    { code: 'NUR1101', nameEn: 'Fundamentals of Nursing', credits: 3 },
    { code: 'NUR1102', nameEn: 'Human Anatomy & Physiology', credits: 3 },
  ];
  const subjects: Record<string, string> = {};
  for (const s of subjectDefs) {
    const subject = await prisma.subject.upsert({
      where: { programId_code: { programId: program.id, code: s.code } },
      update: {},
      create: { programId: program.id, courseId: course.id, ...s },
    });
    subjects[s.code] = subject.id;
  }
  console.log(`  ✓ course + ${subjectDefs.length} subjects`);

  // ---- Lecturer -----------------------------------------------------------
  const lecturerUser = await prisma.user.upsert({
    where: { universityId_email: { universityId: university.id, email: 'p.somchai@nursing.au.edu' } },
    update: {},
    create: {
      universityId: university.id, email: 'p.somchai@nursing.au.edu',
      passwordHash: await bcrypt.hash('ChangeMe!2026', 12), status: 'ACTIVE',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: lecturerUser.id, roleId: roles.LECTURER } },
    update: {},
    create: { userId: lecturerUser.id, roleId: roles.LECTURER },
  });
  const lecturer = await prisma.lecturer.upsert({
    where: { universityId_employeeCode: { universityId: university.id, employeeCode: 'EMP-0001' } },
    update: {},
    create: {
      universityId: university.id, facultyId: faculty.id, departmentId: department.id,
      userId: lecturerUser.id, employeeCode: 'EMP-0001',
      nameEn: 'Dr. Somchai Prasert', nameTh: 'ดร. สมชาย ประเสริฐ',
      position: 'Assistant Professor', email: 'p.somchai@nursing.au.edu', office: 'CL-1005',
    },
  });
  console.log('  ✓ lecturer');

  // ---- Section + weekly schedule -----------------------------------------
  const section = await prisma.section.upsert({
    where: {
      subjectId_semesterId_sectionNo: {
        subjectId: subjects.NUR1101, semesterId: semester.id, sectionNo: '001',
      },
    },
    update: {},
    create: {
      universityId: university.id, subjectId: subjects.NUR1101, semesterId: semester.id,
      lecturerId: lecturer.id, roomId: rooms['CL-1101'], sectionNo: '001', capacity: 40,
    },
  });
  // Second section (a different subject) so the timetable grid is meaningful.
  const section2 = await prisma.section.upsert({
    where: {
      subjectId_semesterId_sectionNo: {
        subjectId: subjects.NUR1102, semesterId: semester.id, sectionNo: '001',
      },
    },
    update: {},
    create: {
      universityId: university.id, subjectId: subjects.NUR1102, semesterId: semester.id,
      lecturerId: lecturer.id, roomId: rooms['CL-1102'], sectionNo: '001', capacity: 40,
    },
  });

  // Weekly schedule slots (idempotent per day+time).
  const scheduleDefs = [
    { sectionId: section.id, roomId: rooms['CL-1101'], dayOfWeek: DayOfWeek.MONDAY, startTime: '09:00', endTime: '12:00' },
    { sectionId: section.id, roomId: rooms['NLAB-01'], dayOfWeek: DayOfWeek.THURSDAY, startTime: '13:00', endTime: '15:00' },
    { sectionId: section2.id, roomId: rooms['CL-1102'], dayOfWeek: DayOfWeek.WEDNESDAY, startTime: '13:00', endTime: '16:00' },
  ];
  for (const sc of scheduleDefs) {
    const exists = await prisma.sectionSchedule.findFirst({
      where: { sectionId: sc.sectionId, dayOfWeek: sc.dayOfWeek, startTime: sc.startTime },
    });
    if (!exists) {
      await prisma.sectionSchedule.create({ data: { ...sc, lecturerId: lecturer.id } });
    }
  }
  console.log(`  ✓ 2 sections + ${scheduleDefs.length} weekly schedule slots`);

  // ---- Students + enrollment ---------------------------------------------
  const studentDefs = [
    { studentCode: '6510001', nameEn: 'Napat Wong', nameTh: 'ณภัทร วงศ์', nickname: 'Ploy', gender: Gender.FEMALE },
    { studentCode: '6510002', nameEn: 'Krit Chan', nameTh: 'กฤต จันทร์', nickname: 'Beam', gender: Gender.MALE },
  ];
  for (const s of studentDefs) {
    const student = await prisma.student.upsert({
      where: { universityId_studentCode: { universityId: university.id, studentCode: s.studentCode } },
      update: {},
      create: {
        universityId: university.id, programId: program.id, admissionYear: 2026,
        qrCode: `AU-STU-${s.studentCode}`, ...s,
      },
    });
    for (const sec of [section.id, section2.id]) {
      await prisma.enrollment.upsert({
        where: { sectionId_studentId: { sectionId: sec, studentId: student.id } },
        update: {},
        create: { sectionId: sec, studentId: student.id },
      });
    }
  }
  for (const sec of [section.id, section2.id]) {
    await prisma.section.update({
      where: { id: sec },
      data: { currentEnrollment: await prisma.enrollment.count({ where: { sectionId: sec, status: 'ENROLLED' } }) },
    });
  }
  console.log(`  ✓ ${studentDefs.length} students enrolled into 2 sections`);

  // ---- Expand schedules into concrete class sessions across the semester ---
  const JS_DAY = [
    DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY,
  ];
  const allSchedules = await prisma.sectionSchedule.findMany({
    where: { section: { semesterId: semester.id } },
    select: { sectionId: true, roomId: true, lecturerId: true, dayOfWeek: true, startTime: true, endTime: true },
  });
  const sessionRows: {
    sectionId: string; roomId: string | null; lecturerId: string | null;
    sessionDate: Date; startTime: string; endTime: string;
  }[] = [];
  for (let d = new Date(semester.startDate); d <= semester.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = JS_DAY[d.getUTCDay()];
    for (const sc of allSchedules) {
      if (sc.dayOfWeek !== dow) continue;
      sessionRows.push({
        sectionId: sc.sectionId, roomId: sc.roomId, lecturerId: sc.lecturerId,
        sessionDate: new Date(d), startTime: sc.startTime, endTime: sc.endTime,
      });
    }
  }
  const gen = await prisma.classSession.createMany({ data: sessionRows, skipDuplicates: true });
  console.log(`  ✓ generated ${gen.count} class sessions`);

  // ---- Calendar entries (personal appointment + faculty activity) ---------
  const calDefs = [
    {
      type: 'PERSONAL' as const, visibility: 'PRIVATE' as const,
      title: 'พบนักศึกษา Year 2 (advising)',
      startAt: new Date('2026-07-09T15:30:00+07:00'), endAt: new Date('2026-07-09T16:30:00+07:00'),
      lecturerId: lecturer.id, color: '#6fa3d6',
    },
    {
      type: 'ACTIVITY' as const, visibility: 'FACULTY' as const,
      title: 'อบรมทักษะการพยาบาล (Skills Workshop)',
      startAt: new Date('2026-07-10T09:00:00+07:00'), endAt: new Date('2026-07-10T12:00:00+07:00'),
      roomId: rooms['NLAB-01'], color: '#ff8a4c',
    },
    {
      type: 'EXAM' as const, visibility: 'FACULTY' as const,
      title: 'สอบกลางภาค NUR1101 (Midterm)',
      startAt: new Date('2026-07-08T13:00:00+07:00'), endAt: new Date('2026-07-08T15:00:00+07:00'),
      roomId: rooms['CL-1101'], color: '#e2564d',
    },
  ];
  for (const c of calDefs) {
    const exists = await prisma.calendarEntry.findFirst({ where: { universityId: university.id, title: c.title, startAt: c.startAt } });
    if (!exists) {
      await prisma.calendarEntry.create({ data: { universityId: university.id, ...c } });
    }
  }
  console.log(`  ✓ ${calDefs.length} calendar entries`);

  // ---- Attendance history (so analytics/risk has real data) ---------------
  const cutoff = new Date('2026-07-09T00:00:00+07:00');
  const enrollmentsAll = await prisma.enrollment.findMany({
    where: { section: { universityId: university.id } },
    select: { id: true, studentId: true, sectionId: true, student: { select: { studentCode: true } } },
  });
  let recordCount = 0;
  for (const en of enrollmentsAll) {
    const past = await prisma.classSession.findMany({
      where: { sectionId: en.sectionId, sessionDate: { lt: cutoff } },
      select: { id: true }, orderBy: { sessionDate: 'asc' },
    });
    let attended = 0;
    for (let i = 0; i < past.length; i++) {
      const isKrit = en.student.studentCode === '6510002'; // deliberately at-risk
      const status = isKrit
        ? (i % 2 === 0 ? 'ABSENT' : (i % 3 === 0 ? 'LATE' : 'PRESENT'))
        : (i % 13 === 0 ? 'ABSENT' : (i % 7 === 0 ? 'LATE' : 'PRESENT'));
      if (status !== 'ABSENT') attended++;
      await prisma.attendanceRecord.upsert({
        where: { classSessionId_enrollmentId: { classSessionId: past[i].id, enrollmentId: en.id } },
        update: {},
        create: {
          classSessionId: past[i].id, enrollmentId: en.id, studentId: en.studentId,
          status: status as 'PRESENT' | 'LATE' | 'ABSENT', method: 'MANUAL',
          checkInAt: status === 'ABSENT' ? null : new Date(),
        },
      });
      recordCount++;
    }
    const rate = past.length > 0 ? Math.round((attended / past.length) * 1000) / 10 : null;
    await prisma.enrollment.update({ where: { id: en.id }, data: { attendanceRate: rate } });
  }
  console.log(`  ✓ ${recordCount} attendance records (history)`);

  // ---- Sample notifications (tenant broadcast) ----------------------------
  const notifDefs = [
    { type: 'BELOW_80', title: 'นักศึกษาเข้าเรียนต่ำกว่า 80%', body: 'กฤต จันทร์ (NUR1101) เข้าเรียน 45.5%', readAt: null },
    { type: 'ATTENDANCE_SUBMITTED', title: 'บันทึกการเช็คชื่อแล้ว', body: 'NUR1101 · คาบวันจันทร์ ส่งข้อมูลการเช็คชื่อเรียบร้อย', readAt: null },
    { type: 'ACTIVITY', title: 'กิจกรรมคณะ', body: 'อบรมทักษะการพยาบาล (Skills Workshop) วันศุกร์นี้', readAt: new Date() },
  ];
  const existingNotif = await prisma.notification.count({ where: { universityId: university.id } });
  if (existingNotif === 0) {
    for (const n of notifDefs) {
      await prisma.notification.create({
        data: { universityId: university.id, channel: 'SYSTEM', status: n.readAt ? 'READ' : 'SENT', type: n.type, title: n.title, body: n.body, sentAt: new Date(), readAt: n.readAt },
      });
    }
  }
  console.log(`  ✓ ${notifDefs.length} sample notifications`);

  // ---- Assessment: preload the 5 bilingual rubrics + default grade scheme --
  const rubricIds: Record<string, string> = {};
  for (const r of RUBRICS) {
    let rubric = await prisma.rubric.findFirst({ where: { universityId: university.id, code: r.code } });
    if (!rubric) {
      rubric = await prisma.rubric.create({
        data: {
          universityId: university.id, code: r.code, nameEn: r.nameEn, nameTh: r.nameTh,
          weightPercent: r.weightPercent, order: r.order,
          sections: {
            create: r.sections.map((s, si) => ({
              nameEn: s.nameEn, nameTh: s.nameTh, weightPercent: s.weightPercent, order: si,
              items: {
                create: s.items.map((item, ii) => ({
                  textEn: item.en, textTh: item.th, order: ii, maxRating: 5,
                  weightPercent: Math.round((100 / s.items.length) * 100) / 100,
                })),
              },
            })),
          },
        },
      });
    }
    rubricIds[r.code] = rubric.id;
  }
  console.log(`  ✓ ${RUBRICS.length} assessment rubrics (bilingual)`);

  // Not every subject uses every rubric — configure which apply per subject.
  // NUR1101 (clinical fundamentals): all 5, at their default weights (=100%).
  // NUR1102 (anatomy & physiology, theory-only): just report + conference,
  // re-weighted to still total 100% — demonstrates the per-subject override.
  const subjectRubricPlan: Record<string, { code: string; weightPercent: number }[]> = {
    NUR1101: RUBRICS.map((r) => ({ code: r.code, weightPercent: r.weightPercent })),
    NUR1102: [
      { code: 'CASE_REPORT', weightPercent: 60 },
      { code: 'PRE_POST_CONFERENCE', weightPercent: 40 },
    ],
  };
  for (const [subjectCode, plan] of Object.entries(subjectRubricPlan)) {
    const subjectId = subjects[subjectCode];
    if (!subjectId) continue;
    for (const [i, p] of plan.entries()) {
      await prisma.subjectRubric.upsert({
        where: { subjectId_rubricId: { subjectId, rubricId: rubricIds[p.code] } },
        update: { weightPercent: p.weightPercent, isActive: true, order: i },
        create: { subjectId, rubricId: rubricIds[p.code], weightPercent: p.weightPercent, isActive: true, order: i },
      });
    }
  }
  console.log('  ✓ per-subject rubric selection (NUR1101: all 5 · NUR1102: report+conference only)');

  const existingScheme = await prisma.gradeScheme.findFirst({ where: { universityId: university.id, isDefault: true } });
  if (!existingScheme) {
    await prisma.gradeScheme.create({
      data: {
        universityId: university.id, name: 'Default', isDefault: true,
        bands: { create: GRADE_BANDS.map((b, i) => ({ ...b, order: i })) },
      },
    });
  }
  console.log(`  ✓ default grade scheme (${GRADE_BANDS.length} bands)`);

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
