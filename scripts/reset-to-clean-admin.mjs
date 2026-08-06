// One-shot: wipe every example/demo/test record from the database (all
// seeded students, lecturers, sections, filled-in evaluation scores,
// attendance, courses/subjects, notifications, reports, audit history, and
// every user account) while KEEPING the real, reusable structural setup —
// University, Faculty, Departments, Program, Campus/Building/Rooms,
// AcademicYear/Semester, RBAC roles+permissions, the default attendance
// rule, app Settings, and — per explicit request — the Rubric evaluation
// form templates themselves (just not the demo scores filled into them).
// Then creates exactly one fresh ADMIN user.
//
// Safe to run against Neon: only ever seed/demo content has existed there
// (created by `npm run db:seed`), never real student/exam data.
//
// Run:  node scripts/reset-to-clean-admin.mjs
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';

const ADMIN_EMAIL = 'abacnurse@au.edu';
const ADMIN_TEMP_PASSWORD = 'ABACnurse@6008';

// Same trick as `read -rs` in bash (used successfully in db-setup.sh): turn
// off terminal echo at the tty level for the duration of the read, so typed
// characters never appear on screen, then restore it. Falls back to a
// normal (visible) read if stdin isn't a real TTY (e.g. piped input).
//
// Reads via the readline async iterator rather than rl.question() — calling
// question() twice in a row on the same interface reliably hangs on the
// second call when stdin is piped (a known Node readline quirk: the stream
// doesn't resume properly between calls). The async iterator drives off the
// stream's natural flow and doesn't have this problem.
const isTTY = Boolean(process.stdin.isTTY);
const rl = createInterface({ input: process.stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();

async function askHidden(prompt) {
  process.stdout.write(prompt);
  if (isTTY) {
    try { execSync('stty -echo', { stdio: 'inherit' }); } catch { /* best-effort */ }
  }
  const { value } = await lines.next();
  if (isTTY) {
    try { execSync('stty echo', { stdio: 'inherit' }); } catch { /* best-effort */ }
  }
  process.stdout.write('\n');
  return (value ?? '').trim();
}

async function main() {
  console.log('==================================================');
  console.log('  ClassWeb — reset to a clean slate + fresh admin');
  console.log('==================================================\n');

  const dbUrl = await askHidden('DATABASE_URL (Neon, pooled): ');
  if (!dbUrl || !/^postgres(ql)?:\/\//.test(dbUrl)) {
    console.error('\n❌ That does not look like a Postgres connection string. Aborting.');
    rl.close();
    process.exit(1);
  }

  console.log('\nThis PERMANENTLY deletes every student, lecturer, section, evaluation');
  console.log('score, attendance record, subject/course, notification, report, and user');
  console.log('account in this database (keeps University/Faculty/rooms/academic-year/');
  console.log('RBAC/Rubric evaluation-form templates).');
  const confirm = await askHidden('Type YES to continue: ');
  if (confirm !== 'YES') {
    console.log('Aborted — nothing was changed.');
    rl.close();
    process.exit(0);
  }
  rl.close();

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    console.log('\n==> Deleting example/demo/transactional data (FK-safe order)…');

    // Assessment / evaluation — keep the Rubric templates themselves
    // (RubricSection/RubricItem), only clear the demo scores filled into
    // them and the demo subject<->rubric weight assignments.
    await prisma.evaluationScore.deleteMany({});
    await prisma.evaluation.deleteMany({});
    await prisma.subjectRubric.deleteMany({});

    // Attendance
    await prisma.attendanceCheckIn.deleteMany({});
    await prisma.attendanceSession.deleteMany({});
    await prisma.attendanceRecord.deleteMany({});

    // Timetable / calendar
    await prisma.classSession.deleteMany({});
    await prisma.sectionSchedule.deleteMany({});
    await prisma.calendarEntry.deleteMany({});
    await prisma.calendarEvent.deleteMany({});

    // Rosters
    await prisma.enrollment.deleteMany({});
    await prisma.sectionLecturer.deleteMany({});
    await prisma.section.deleteMany({});

    // Curriculum test data (example subjects/courses — real ones get re-added via the UI)
    await prisma.subject.deleteMany({});
    await prisma.course.deleteMany({});

    // Notes / notifications / reports / audit / backups
    await prisma.studentNote.deleteMany({});
    await prisma.pushSubscription.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.report.deleteMany({});
    await prisma.backup.deleteMany({});
    await prisma.auditLog.deleteMany({});

    // People + accounts
    await prisma.googleCalendarConnection.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.userRole.deleteMany({});
    await prisma.student.deleteMany({});
    await prisma.lecturer.deleteMany({});
    await prisma.user.deleteMany({});

    console.log('✓ demo data cleared\n');

    console.log('==> Creating fresh admin account…');
    const university = await prisma.university.findFirstOrThrow({ where: { code: 'AU' } });
    const adminRole = await prisma.role.findFirstOrThrow({ where: { universityId: university.id, code: 'ADMIN' } });

    const passwordHash = await bcrypt.hash(ADMIN_TEMP_PASSWORD, 12);
    const admin = await prisma.user.create({
      data: { universityId: university.id, email: ADMIN_EMAIL, passwordHash, status: 'ACTIVE' },
    });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } });

    console.log(`✓ admin created: ${ADMIN_EMAIL}\n`);
    console.log('==================================================');
    console.log('✅ Done. The database now has only real structural');
    console.log('   config (university/faculty/rooms/academic year/RBAC)');
    console.log('   and one fresh admin account.');
    console.log('');
    console.log(`   Login:    ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_TEMP_PASSWORD}   (change it on first login)`);
    console.log('==================================================');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error('\n❌ Failed:', err.message); process.exit(1); });
