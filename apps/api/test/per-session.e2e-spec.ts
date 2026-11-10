import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };

/**
 * A per-session rubric (clinical "Nursing performance") is marked every
 * practice day. The component is split evenly across the section's practice
 * days and builds up day by day: score = sum of day scores ÷ days that count.
 * Days the student was absent or on leave don't count.
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

  const componentScore = async () =>
    (await prisma.evaluation.findFirstOrThrow({ where: { rubricId, studentId, sectionId, classSessionId: null } })).scorePercent;
  const save = (body: object) => http.post('/api/v1/assessment/evaluation').set('Authorization', `Bearer ${token}`).send(body);
  const day = (classSessionId: string, a: number, b: number) =>
    save({ rubricId, studentId, sectionId, classSessionId, scores: [{ rubricItemId: itemIds[0], rating: a }, { rubricItemId: itemIds[1], rating: b }] });

  it('needs a day for a per-session rubric', async () => {
    await save({ rubricId, studentId, sectionId, scores: [{ rubricItemId: itemIds[0], rating: 5 }] }).expect(400);
  });

  it('builds the component up day by day over all practice days, and summaries count it once', async () => {
    const d1 = await day(sessionIds[0], 5, 5).expect(201); // 100% on day 1 of 3
    expect(d1.body.sessionAverage).toEqual({ scorePercent: 33.33, sessions: 1, countedDays: 3 });
    const d2 = await day(sessionIds[1], 3, 3).expect(201); // 60%
    expect(d2.body.sessionAverage).toEqual({ scorePercent: 53.33, sessions: 2, countedDays: 3 });
    // Re-marking a day replaces it rather than adding a third.
    const d2b = await day(sessionIds[1], 4, 4).expect(201); // 80%
    expect(d2b.body.sessionAverage).toEqual({ scorePercent: 60, sessions: 2, countedDays: 3 });

    const summary = await http.get(`/api/v1/assessment/sections/${sectionId}/summary`).set('Authorization', `Bearer ${token}`).expect(200);
    const row = summary.body.students.find((s: { studentId: string }) => s.studentId === studentId);
    expect(row.total).toBe(60);
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

  it('leaves a non-practice day (e.g. a presentation day) out of daily assessment', async () => {
    const patch = (id: string, body: object) =>
      http.patch(`/api/v1/timetable/sessions/${id}`).set('Authorization', `Bearer ${token}`).send(body);
    // A day that already holds daily marks can't be taken out.
    await patch(sessionIds[0], { dailyAssessment: false }).expect(409);

    const res = await patch(sessionIds[2], { dailyAssessment: false, topic: 'Case presentation' }).expect(200);
    expect(res.body).toMatchObject({ dailyAssessment: false, topic: 'Case presentation' });
    await day(sessionIds[2], 5, 5).expect(400);

    const form = await http.get('/api/v1/assessment/evaluation')
      .query({ rubricId, studentId, sectionId })
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(form.body.sessions.map((s: { id: string }) => s.id)).toEqual(sessionIds.slice(0, 2).reverse());
    // Two days left to split over: (100 + 80) / 2.
    expect(await componentScore()).toBe(90);
  });

  it('re-splits when a practice day is added, and leaves out a day the student was absent', async () => {
    const section = await prisma.section.findUniqueOrThrow({ where: { id: sectionId }, include: { semester: true } });
    const date = new Date(section.semester.endDate.getTime() - 4 * 86_400_000).toISOString().slice(0, 10);
    await http.post('/api/v1/timetable/sessions').set('Authorization', `Bearer ${token}`)
      .send({ sectionId, dates: [date], startTime: '07:00', endTime: '16:00' }).expect(201);
    expect(await componentScore()).toBe(60); // (100 + 80) / 3 — the new day isn't earned yet

    const added = await prisma.classSession.findFirstOrThrow({ where: { sectionId, sessionDate: new Date(`${date}T00:00:00Z`) } });
    await http.post('/api/v1/attendance/records').set('Authorization', `Bearer ${token}`)
      .send({ classSessionId: added.id, studentId, status: 'ABSENT' }).expect(201);
    expect(await componentScore()).toBe(90); // absent: that day doesn't count

    await http.post('/api/v1/attendance/records').set('Authorization', `Bearer ${token}`)
      .send({ classSessionId: added.id, studentId, status: 'PRESENT' }).expect(201);
    expect(await componentScore()).toBe(60); // present again: the day counts, not yet earned
  });
});
