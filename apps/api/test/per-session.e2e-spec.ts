import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };

/**
 * A per-session rubric (clinical "Nursing performance") is marked every
 * practice day; its term score is the average of the days marked so far.
 * Built on its own subject/section/rubric so no other suite's data moves.
 */
describe('Per-session (daily) assessment', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let token: string;
  let sectionId: string, studentId: string, rubricId: string, itemIds: string[], sessionIds: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    token = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;

    const base = await prisma.section.findFirstOrThrow({ include: { subject: true, semester: true } });
    const student = await prisma.student.findFirstOrThrow({ where: { universityId: base.universityId } });
    const subject = await prisma.subject.create({ data: { programId: base.subject.programId, courseId: base.subject.courseId, code: `PS${Date.now() % 100000}`, nameEn: 'Practicum' } });
    const section = await prisma.section.create({ data: { universityId: base.universityId, subjectId: subject.id, semesterId: base.semesterId, sectionNo: '1' } });
    await prisma.enrollment.create({ data: { sectionId: section.id, studentId: student.id } });
    const rubric = await prisma.rubric.create({
      data: {
        universityId: base.universityId, nameEn: 'Nursing performance', perSession: true,
        sections: { create: [{ nameEn: 'Performance', weightPercent: 100, items: { create: [{ textEn: 'A', weightPercent: 50 }, { textEn: 'B', weightPercent: 50 }] } }] },
      },
      include: { sections: { include: { items: { orderBy: { textEn: 'asc' } } } } },
    });
    await prisma.subjectRubric.create({ data: { subjectId: subject.id, rubricId: rubric.id, weightPercent: 100 } });
    const end = base.semester.endDate.getTime();
    const sessions = await Promise.all([1, 2, 3].map((i) => prisma.classSession.create({
      data: { sectionId: section.id, sessionDate: new Date(end - i * 86_400_000), startTime: '07:00', endTime: '16:00' },
    })));
    sectionId = section.id; studentId = student.id; rubricId = rubric.id;
    itemIds = rubric.sections[0].items.map((i) => i.id);
    sessionIds = sessions.map((s) => s.id);
  });

  afterAll(async () => { await app?.close(); });

  const save = (body: object) => http.post('/api/v1/assessment/evaluation').set('Authorization', `Bearer ${token}`).send(body);
  const day = (classSessionId: string, a: number, b: number) =>
    save({ rubricId, studentId, sectionId, classSessionId, scores: [{ rubricItemId: itemIds[0], rating: a }, { rubricItemId: itemIds[1], rating: b }] });

  it('needs a day for a per-session rubric', async () => {
    await save({ rubricId, studentId, sectionId, scores: [{ rubricItemId: itemIds[0], rating: 5 }] }).expect(400);
  });

  it('averages the days assessed into the component score, and summaries count it once', async () => {
    const d1 = await day(sessionIds[0], 5, 5).expect(201); // 100%
    expect(d1.body.sessionAverage).toEqual({ scorePercent: 100, sessions: 1 });
    const d2 = await day(sessionIds[1], 3, 3).expect(201); // 60%
    expect(d2.body.sessionAverage).toEqual({ scorePercent: 80, sessions: 2 });
    // Re-marking a day replaces it rather than adding a third.
    const d2b = await day(sessionIds[1], 4, 4).expect(201); // 80%
    expect(d2b.body.sessionAverage).toEqual({ scorePercent: 90, sessions: 2 });

    const summary = await http.get(`/api/v1/assessment/sections/${sectionId}/summary`).set('Authorization', `Bearer ${token}`).expect(200);
    const row = summary.body.students.find((s: { studentId: string }) => s.studentId === studentId);
    expect(row.total).toBe(90);
    expect(row.gradedCount).toBe(1);

    const form = await http.get('/api/v1/assessment/evaluation')
      .query({ rubricId, studentId, sectionId, classSessionId: sessionIds[1] })
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(form.body.evaluation.scorePercent).toBe(80);
    expect(form.body.sessions).toHaveLength(3);
    expect(form.body.sessions.filter((s: { scorePercent: number | null }) => s.scorePercent != null)).toHaveLength(2);
  });

  it('rejects a session from another section, and a day on a once-per-term rubric', async () => {
    const other = await prisma.classSession.findFirstOrThrow({ where: { sectionId: { not: sectionId } } });
    await day(other.id, 5, 5).expect(400);
    const termRubric = await prisma.rubric.findFirstOrThrow({ where: { perSession: false } });
    await save({ rubricId: termRubric.id, studentId, sectionId, classSessionId: sessionIds[2], scores: [] }).expect(400);
  });
});
