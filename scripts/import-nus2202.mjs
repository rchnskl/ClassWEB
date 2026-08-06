// Imports the NUS 2202 (semester 1/2026) setup transcribed from the four
// official documents — see scripts/data/nus2202.mjs for the data and its
// provenance.
//
// Creates / updates, in dependency order:
//   Course "NUS" -> Subject NUS2202 -> Sections 71..76
//   4 lecturers (proctors, no login accounts — no emails in the documents)
//   58 students + their enrolments
//   6 laboratory-examination calendar entries (midterm + final)
//
// Fully idempotent: every write is an upsert on a natural key, so re-running
// it after fixing a typo updates rather than duplicates. Requires the
// University (AU), Program (BNS) and the current Semester to already exist —
// they are created by the seed and survive scripts/reset-to-clean-admin.mjs.
//
// Run:  node scripts/import-nus2202.mjs
import { PrismaClient } from '@prisma/client';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';
import { SUBJECT, LECTURERS, ROSTER, LAB_EXAMS, LAB_PROCEDURES } from './data/nus2202.mjs';

// Course is a required parent of Subject in this schema. The documents name
// only the subject, so subjects are grouped under one faculty-level course.
const COURSE = { code: 'NUS', nameEn: 'Nursing Science' };
const IMPORT_TAG = 'NUS2202-1-2026';
const BKK = '+07:00';

const isTTY = Boolean(process.stdin.isTTY);
const rl = createInterface({ input: process.stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();

async function askHidden(prompt) {
  process.stdout.write(prompt);
  if (isTTY) { try { execSync('stty -echo', { stdio: 'inherit' }); } catch { /* best-effort */ } }
  const { value } = await lines.next();
  if (isTTY) { try { execSync('stty echo', { stdio: 'inherit' }); } catch { /* best-effort */ } }
  process.stdout.write('\n');
  return (value ?? '').trim();
}

async function main() {
  console.log('==================================================');
  console.log('  ClassWeb — import NUS 2202, semester 1/2026');
  console.log('==================================================\n');
  console.log(`Will import: 1 subject · 6 sections · ${LECTURERS.length} lecturers ·`);
  console.log(`             ${Object.values(ROSTER).flat().length} students + enrolments · ${LAB_EXAMS.length} exam entries\n`);

  const dbUrl = await askHidden('DATABASE_URL (Neon, pooled): ');
  if (!dbUrl || !/^postgres(ql)?:\/\//.test(dbUrl)) {
    console.error('\n❌ That does not look like a Postgres connection string. Aborting.');
    rl.close();
    process.exit(1);
  }
  rl.close();

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    // ---- prerequisites (created by the seed) -----------------------------
    const university = await prisma.university.findFirstOrThrow({ where: { code: 'AU' } });
    const faculty = await prisma.faculty.findFirstOrThrow({ where: { universityId: university.id, code: 'NURSING' } });
    const program = await prisma.program.findFirstOrThrow({ where: { facultyId: faculty.id, code: 'BNS' } });
    const semester = await prisma.semester.findFirstOrThrow({
      where: { isCurrent: true, academicYear: { universityId: university.id } },
      include: { academicYear: true },
    });
    console.log(`==> Target: ${university.code} / ${faculty.code} / ${program.code}`);
    console.log(`    Semester: ${semester.academicYear.code} ${semester.nameEn}\n`);

    // ---- course + subject ------------------------------------------------
    const course = await prisma.course.upsert({
      where: { programId_code: { programId: program.id, code: COURSE.code } },
      update: { nameEn: COURSE.nameEn },
      create: { programId: program.id, code: COURSE.code, nameEn: COURSE.nameEn },
    });
    const subject = await prisma.subject.upsert({
      where: { programId_code: { programId: program.id, code: SUBJECT.code } },
      update: { nameEn: SUBJECT.nameEn, courseId: course.id },
      create: { programId: program.id, courseId: course.id, code: SUBJECT.code, nameEn: SUBJECT.nameEn },
    });
    console.log(`✓ course ${course.code} · subject ${subject.code} ${subject.nameEn}`);

    // ---- lecturers (proctors) -------------------------------------------
    for (const l of LECTURERS) {
      await prisma.lecturer.upsert({
        where: { universityId_employeeCode: { universityId: university.id, employeeCode: l.employeeCode } },
        update: { nameEn: l.nameEn, position: l.position ?? null },
        create: {
          universityId: university.id, facultyId: faculty.id,
          employeeCode: l.employeeCode, nameEn: l.nameEn, position: l.position ?? null,
        },
      });
    }
    console.log(`✓ ${LECTURERS.length} lecturers (no login accounts — emails not in the documents)`);

    // ---- sections --------------------------------------------------------
    const sectionIds = {};
    for (const sectionNo of Object.keys(ROSTER)) {
      const capacity = Math.max(40, ROSTER[sectionNo].length);
      const section = await prisma.section.upsert({
        where: { subjectId_semesterId_sectionNo: { subjectId: subject.id, semesterId: semester.id, sectionNo } },
        update: { capacity },
        create: {
          universityId: university.id, subjectId: subject.id, semesterId: semester.id,
          sectionNo, capacity,
        },
      });
      sectionIds[sectionNo] = section.id;
    }
    console.log(`✓ ${Object.keys(sectionIds).length} sections (${Object.keys(ROSTER).join(', ')})`);

    // ---- students + enrolments -------------------------------------------
    let created = 0, updated = 0, enrolled = 0;
    for (const [sectionNo, rows] of Object.entries(ROSTER)) {
      for (const [studentCode, gender, nameEn] of rows) {
        const existing = await prisma.student.findFirst({
          where: { universityId: university.id, studentCode },
          select: { id: true },
        });
        const student = await prisma.student.upsert({
          where: { universityId_studentCode: { universityId: university.id, studentCode } },
          update: { nameEn, gender, programId: program.id },
          create: { universityId: university.id, programId: program.id, studentCode, nameEn, gender },
        });
        if (existing) updated++; else created++;

        await prisma.enrollment.upsert({
          where: { sectionId_studentId: { sectionId: sectionIds[sectionNo], studentId: student.id } },
          update: { status: 'ENROLLED' },
          create: { sectionId: sectionIds[sectionNo], studentId: student.id, status: 'ENROLLED' },
        });
        enrolled++;
      }
    }
    // Keep the denormalised counter the dashboards read in sync.
    for (const [sectionNo, id] of Object.entries(sectionIds)) {
      await prisma.section.update({ where: { id }, data: { currentEnrollment: ROSTER[sectionNo].length } });
    }
    console.log(`✓ students: ${created} created, ${updated} updated · ${enrolled} enrolments`);

    // ---- laboratory examination calendar entries -------------------------
    // No natural unique key on CalendarEntry, so clear this import's own
    // previous entries (tagged in metadata) before re-creating them.
    const { count: removed } = await prisma.calendarEntry.deleteMany({
      where: { universityId: university.id, type: 'EXAM', metadata: { path: ['importTag'], equals: IMPORT_TAG } },
    });
    const proctorLine = LECTURERS.map((l) => `${l.nameEn} (${l.employeeCode})`).join(', ');
    for (const e of LAB_EXAMS) {
      const label = e.kind === 'MIDTERM' ? 'Midterm' : 'Final';
      await prisma.calendarEntry.create({
        data: {
          universityId: university.id,
          type: 'EXAM',
          visibility: 'FACULTY',
          title: `${SUBJECT.code} Lab Exam (${label}) — Sect. ${e.sections.join(', ')}`,
          description: [
            `${SUBJECT.code} ${SUBJECT.nameEn} — laboratory ${label.toLowerCase()} examination.`,
            `Sections: ${e.sections.join(', ')}`,
            `Proctors: ${proctorLine}`,
            e.kind === 'MIDTERM' ? `Stations (15 min each): ${LAB_PROCEDURES.join('; ')}` : null,
          ].filter(Boolean).join('\n'),
          startAt: new Date(`${e.date}T${e.from}:00${BKK}`),
          endAt: new Date(`${e.date}T${e.to}:00${BKK}`),
          metadata: { importTag: IMPORT_TAG, kind: e.kind, sections: e.sections },
        },
      });
    }
    console.log(`✓ ${LAB_EXAMS.length} lab-exam calendar entries${removed ? ` (replaced ${removed} from a previous run)` : ''}`);

    console.log('\n==================================================');
    console.log('✅ Import complete.');
    console.log('==================================================');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error('\n❌ Failed:', err.message); process.exit(1); });
