import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RESET_CONFIRMATION, ResetService } from '../src/maintenance/reset.service';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };
const LECTURER = { email: 'p.somchai@nursing.au.edu', password: 'ChangeMe!2026' };

/**
 * The reset is exercised on a second, throwaway university so the seeded one
 * other suites rely on is untouched — which doubles as the tenant-isolation check.
 */
describe('Archive & reset', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let adminToken: string;
  let lecturerToken: string;
  let otherU: string;

  async function seedOtherTenant() {
    const u = await prisma.university.create({ data: { code: `RESET-${Date.now()}`, nameEn: 'Reset Test U' } });
    const fac = await prisma.faculty.create({ data: { universityId: u.id, code: 'F', nameEn: 'Fac' } });
    const prog = await prisma.program.create({ data: { facultyId: fac.id, code: 'P', nameEn: 'Prog' } });
    const course = await prisma.course.create({ data: { programId: prog.id, code: 'C', nameEn: 'Course' } });
    const subj = await prisma.subject.create({ data: { programId: prog.id, courseId: course.id, code: 'S1', nameEn: 'Subj' } });
    const ay = await prisma.academicYear.create({ data: { universityId: u.id, code: '2569', nameEn: '2026', startDate: new Date('2026-08-01'), endDate: new Date('2027-07-31') } });
    const sem = await prisma.semester.create({ data: { academicYearId: ay.id, type: 'FIRST', nameEn: 'Sem 1', startDate: new Date('2026-08-01'), endDate: new Date('2026-12-31') } });
    const sec = await prisma.section.create({ data: { universityId: u.id, subjectId: subj.id, semesterId: sem.id, sectionNo: '1' } });
    const stu = await prisma.student.create({ data: { universityId: u.id, programId: prog.id, studentCode: 'X1', nameEn: 'Stu' } });
    const enr = await prisma.enrollment.create({ data: { sectionId: sec.id, studentId: stu.id } });
    const cs = await prisma.classSession.create({ data: { sectionId: sec.id, sessionDate: new Date('2026-11-10'), startTime: '07:00', endTime: '16:00' } });
    await prisma.attendanceRecord.create({ data: { classSessionId: cs.id, enrollmentId: enr.id, studentId: stu.id } });
    const grp = await prisma.studentGroup.create({ data: { universityId: u.id, nameEn: 'G1' } });
    await prisma.studentGroupMember.create({ data: { groupId: grp.id, studentId: stu.id } });
    const rub = await prisma.rubric.create({
      data: { universityId: u.id, nameEn: 'R', sections: { create: [{ nameEn: 'S', items: { create: [{ textEn: 'I' }] } }] } },
      include: { sections: { include: { items: true } } },
    });
    await prisma.subjectRubric.create({ data: { subjectId: subj.id, rubricId: rub.id, weightPercent: 100 } });
    const ev = await prisma.evaluation.create({ data: { universityId: u.id, rubricId: rub.id, studentId: stu.id, sectionId: sec.id } });
    await prisma.evaluationScore.create({ data: { evaluationId: ev.id, rubricItemId: rub.sections[0].items[0].id, rating: 4 } });
    await prisma.gradeScheme.create({ data: { universityId: u.id, bands: { create: [{ grade: 'A', gpa: 4, label: 'A', minScore: 85.01 }] } } });
    await prisma.attendanceRule.create({ data: { universityId: u.id } }); // university-wide: must survive
    await prisma.attendanceRule.create({ data: { universityId: u.id, sectionId: sec.id } }); // section-level: cleared
    await prisma.report.create({ data: { universityId: u.id, reportNumber: `R-${Date.now()}`, type: 'X', title: 'T', format: 'PDF' } });
    return { u, fac };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    adminToken = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;
    lecturerToken = (await http.post('/api/v1/auth/login').send(LECTURER)).body.accessToken;
    otherU = (await seedOtherTenant()).u.id;
  });

  afterAll(async () => { await app?.close(); });

  it('is admin-only', async () => {
    await http.get('/api/v1/maintenance/reset-preview').set('Authorization', `Bearer ${lecturerToken}`).expect(403);
    await http.post('/api/v1/maintenance/reset').set('Authorization', `Bearer ${lecturerToken}`)
      .send({ confirmation: RESET_CONFIRMATION, archived: true }).expect(403);
  });

  it('refuses without the exact phrase or the archived confirmation, and changes nothing', async () => {
    const before = await prisma.student.count();
    await http.post('/api/v1/maintenance/reset').set('Authorization', `Bearer ${adminToken}`)
      .send({ confirmation: 'archive and reset', archived: true }).expect(400);
    await http.post('/api/v1/maintenance/reset').set('Authorization', `Bearer ${adminToken}`)
      .send({ confirmation: RESET_CONFIRMATION, archived: false }).expect(400);
    expect(await prisma.student.count()).toBe(before);
  });

  it('previews counts without deleting', async () => {
    const res = await http.get('/api/v1/maintenance/reset-preview').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.confirmation).toBe(RESET_CONFIRMATION);
    expect(res.body.counts.students).toBeGreaterThan(0);
  });

  it('clears one university completely, keeps its structure and settings, and leaves other universities alone', async () => {
    const seededStudents = await prisma.student.count({ where: { universityId: { not: otherU } } });
    const seededRubrics = await prisma.rubric.count({ where: { universityId: { not: otherU } } });
    const resets = app.get(ResetService);

    const preview = await resets.preview(otherU);
    expect(preview.counts.students).toBe(1);
    expect(preview.counts.evaluations).toBe(1);
    expect(preview.counts.sectionAttendanceRules).toBe(1);

    const result = await resets.reset(otherU, (await prisma.user.findFirstOrThrow()).id, RESET_CONFIRMATION, true);
    expect(result.total).toBe(preview.total);

    const after = await resets.preview(otherU);
    expect(after.total).toBe(0);
    // Cascades went too.
    expect(await prisma.evaluationScore.count({ where: { evaluation: { universityId: otherU } } })).toBe(0);
    expect(await prisma.subjectRubric.count({ where: { rubric: { universityId: otherU } } })).toBe(0);
    // Kept: the institution, its university-wide attendance rule, and the
    // assessment definitions (rubrics with their items, grade schemes).
    expect(await prisma.rubricItem.count({ where: { section: { rubric: { universityId: otherU } } } })).toBe(1);
    expect(await prisma.gradeBand.count({ where: { scheme: { universityId: otherU } } })).toBe(1);
    expect(await prisma.faculty.count({ where: { universityId: otherU } })).toBe(1);
    expect(await prisma.attendanceRule.count({ where: { universityId: otherU, sectionId: null } })).toBe(1);
    // The seeded university is untouched.
    expect(await prisma.student.count({ where: { universityId: { not: otherU } } })).toBe(seededStudents);
    expect(await prisma.rubric.count({ where: { universityId: { not: otherU } } })).toBe(seededRubrics);
    // And it's on the record.
    expect(await prisma.auditLog.count({ where: { universityId: otherU, entityType: 'Maintenance' } })).toBe(1);
  });
});
