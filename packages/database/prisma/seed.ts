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

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// RBAC: the permission matrix. Resource:action pairs granted to each role.
// ---------------------------------------------------------------------------
const RESOURCES = [
  'university', 'faculty', 'program', 'course', 'subject', 'section',
  'academicYear', 'semester', 'room', 'building',
  'student', 'lecturer', 'enrollment', 'attendance', 'timetable',
  'report', 'notification', 'setting', 'audit', 'backup', 'user', 'role',
];
const ACTIONS = ['create', 'read', 'update', 'delete', 'export'] as const;

const ROLE_MATRIX: Record<string, (resource: string, action: string) => boolean> = {
  // Faculty admin — full control of the tenant.
  ADMIN: () => true,
  // Lecturer — manage their teaching + attendance, read academic data.
  LECTURER: (r, a) => {
    if (['attendance', 'timetable'].includes(r)) return true;
    if (r === 'report' && ['read', 'export'].includes(a)) return true;
    if (['section', 'student', 'lecturer', 'subject', 'course', 'enrollment'].includes(r) && a === 'read') return true;
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
  const scheduleExists = await prisma.sectionSchedule.findFirst({
    where: { sectionId: section.id, dayOfWeek: DayOfWeek.MONDAY, startTime: '09:00' },
  });
  if (!scheduleExists) {
    await prisma.sectionSchedule.create({
      data: {
        sectionId: section.id, roomId: rooms['CL-1101'], lecturerId: lecturer.id,
        dayOfWeek: DayOfWeek.MONDAY, startTime: '09:00', endTime: '12:00',
      },
    });
  }
  console.log('  ✓ section NUR1101-001 + weekly schedule');

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
    await prisma.enrollment.upsert({
      where: { sectionId_studentId: { sectionId: section.id, studentId: student.id } },
      update: {},
      create: { sectionId: section.id, studentId: student.id },
    });
  }
  // keep the denormalised counter honest
  await prisma.section.update({
    where: { id: section.id },
    data: { currentEnrollment: await prisma.enrollment.count({ where: { sectionId: section.id, status: 'ENROLLED' } }) },
  });
  console.log(`  ✓ ${studentDefs.length} students enrolled`);

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
