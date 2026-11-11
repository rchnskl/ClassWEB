import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };

/**
 * Daily cases: each practice day students (usually pairs) are assigned a
 * patient, and lecturers note how each student did that day.
 */
describe('Daily patient cases & notes', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let admin: string;
  let outsider: string;
  let sessionId: string;
  let enrolled: string[];
  let notEnrolled: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    admin = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;

    // A lecturer who teaches nothing — must not see patient details.
    const l = await http.post('/api/v1/lecturers').set(auth(admin)).send({
      employeeCode: 'EMP-CASE-01', nameEn: 'Dr. Not Teaching', email: 'case.outsider@nursing.au.edu',
    }).expect(201);
    outsider = (await http.post('/api/v1/auth/login').send({ email: 'case.outsider@nursing.au.edu', password: l.body.tempPassword })).body.accessToken;

    const section = await prisma.section.findFirstOrThrow({ where: { enrollments: { some: {} } }, include: { enrollments: true } });
    enrolled = section.enrollments.map((e) => e.studentId);
    const anyStudent = await prisma.student.findFirstOrThrow({ where: { universityId: section.universityId } });
    notEnrolled = (await prisma.student.create({
      data: { universityId: section.universityId, programId: anyStudent.programId, studentCode: `NE${Date.now() % 1_000_000}`, nameEn: 'Not Enrolled' },
    })).id;
    sessionId = (await prisma.classSession.create({
      data: { sectionId: section.id, sessionDate: new Date('2026-11-25T00:00:00Z'), startTime: '07:00', endTime: '16:00' },
    })).id;
  });

  afterAll(async () => { await app?.close(); });

  it('assigns a case to a pair, lists it with the roster, edits and removes it — all audited', async () => {
    const created = await http.post('/api/v1/cases').set(auth(admin)).send({
      classSessionId: sessionId, studentIds: enrolled.slice(0, 2),
      bed: '12', hn: '6512345', patientName: 'ด.ช. ทดสอบ', patientAge: '2 ปี 3 เดือน', diagnosis: 'Pneumonia',
    }).expect(201);
    expect(created.body.students.map((s: { id: string }) => s.id).sort()).toEqual(enrolled.slice(0, 2).sort());

    const day = await http.get('/api/v1/cases').query({ classSessionId: sessionId }).set(auth(admin)).expect(200);
    expect(day.body.cases).toHaveLength(1);
    expect(day.body.cases[0]).toMatchObject({ bed: '12', hn: '6512345', patientAge: '2 ปี 3 เดือน' });
    expect(day.body.roster.length).toBe(enrolled.length);

    const edited = await http.patch(`/api/v1/cases/${created.body.id}`).set(auth(admin))
      .send({ bed: '14', studentIds: [enrolled[0]] }).expect(200);
    expect(edited.body.bed).toBe('14');
    expect(edited.body.students).toHaveLength(1);

    await http.delete(`/api/v1/cases/${created.body.id}`).set(auth(admin)).expect(200);
    const logs = await prisma.auditLog.findMany({ where: { entityType: 'PatientCase', entityId: created.body.id } });
    expect(logs.map((l) => l.action).sort()).toEqual(['CREATE', 'DELETE', 'UPDATE']);
    // The audit trail records who did what, not the patient's details.
    expect(JSON.stringify(logs.map((l) => l.metadata))).not.toContain('6512345');
  });

  it('only takes students enrolled in the section', async () => {
    await http.post('/api/v1/cases').set(auth(admin))
      .send({ classSessionId: sessionId, studentIds: [enrolled[0], notEnrolled], bed: '1' }).expect(400);
  });

  it('keeps patient details from lecturers who do not teach the section', async () => {
    await http.get('/api/v1/cases').query({ classSessionId: sessionId }).set(auth(outsider)).expect(403);
    await http.post('/api/v1/cases').set(auth(outsider)).send({ classSessionId: sessionId, studentIds: [enrolled[0]] }).expect(403);
  });

  it("adds daily notes per student, shown under that student for that day", async () => {
    await http.post('/api/v1/cases/notes').set(auth(admin))
      .send({ classSessionId: sessionId, studentId: enrolled[0], content: 'เตรียมข้อมูลผู้ป่วยมาครบ' }).expect(201);
    await http.post('/api/v1/cases/notes').set(auth(admin))
      .send({ classSessionId: sessionId, studentId: enrolled[0], content: 'ตอบคำถามเรื่องยาได้ดี' }).expect(201);
    await http.post('/api/v1/cases/notes').set(auth(admin))
      .send({ classSessionId: sessionId, studentId: notEnrolled, content: 'x' }).expect(400);

    const day = await http.get('/api/v1/cases').query({ classSessionId: sessionId }).set(auth(admin)).expect(200);
    const row = day.body.roster.find((r: { id: string }) => r.id === enrolled[0]);
    expect(row.notes.map((n: { content: string }) => n.content)).toEqual(['เตรียมข้อมูลผู้ป่วยมาครบ', 'ตอบคำถามเรื่องยาได้ดี']);
    expect(row.notes[0].authorName).toBeTruthy();
    // They are ordinary student notes too, so they show in the student's record.
    const all = await http.get(`/api/v1/students/${enrolled[0]}/notes`).set(auth(admin)).expect(200);
    expect(all.body.items.some((n: { content: string }) => n.content === 'ตอบคำถามเรื่องยาได้ดี')).toBe(true);
  });

  it("offers yesterday's cases for today, carries them forward, and leaves out a patient who went home", async () => {
    const section = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } });
    const next = (await prisma.classSession.create({
      data: { sectionId: section.sectionId, sessionDate: new Date('2026-11-26T00:00:00Z'), startTime: '07:00', endTime: '16:00' },
    })).id;
    const auth2 = auth(admin);
    const stay = (await http.post('/api/v1/cases').set(auth2).send({
      classSessionId: sessionId, studentIds: enrolled.slice(0, 2), bed: '3', hn: 'HN-STAY', patientName: 'ด.ช. คงอยู่', diagnosis: 'Asthma',
    }).expect(201)).body;
    const home = (await http.post('/api/v1/cases').set(auth2).send({
      classSessionId: sessionId, studentIds: [enrolled[0]], bed: '4', hn: 'HN-HOME',
    }).expect(201)).body;
    // The patient in bed 4 goes home: the case stays on that day, marked.
    const discharged = await http.patch(`/api/v1/cases/${home.id}/discharge`).set(auth2).send({ discharged: true }).expect(200);
    expect(discharged.body.dischargedAt).toBeTruthy();

    const day2 = await http.get('/api/v1/cases').query({ classSessionId: next }).set(auth2).expect(200);
    expect(day2.body.previous.session.id).toBe(sessionId);
    const offered = day2.body.previous.cases.map((c: { id: string }) => c.id);
    expect(offered).toContain(stay.id);
    expect(offered).not.toContain(home.id);

    // A discharged case can't be carried forward.
    await http.post('/api/v1/cases/carry-forward').set(auth2).send({ classSessionId: next, caseIds: [home.id] }).expect(400);

    const carried = await http.post('/api/v1/cases/carry-forward').set(auth2).send({ classSessionId: next, caseIds: [stay.id] }).expect(201);
    expect(carried.body.created).toBe(1);
    const copy = carried.body.cases[0];
    expect(copy).toMatchObject({ bed: '3', hn: 'HN-STAY', diagnosis: 'Asthma', continuedFromId: stay.id });
    expect(copy.continuedFromDate.slice(0, 10)).toBe('2026-11-25');
    expect(copy.students.map((x: { id: string }) => x.id).sort()).toEqual(enrolled.slice(0, 2).sort());

    // Carrying again is a no-op, and it is no longer offered.
    expect((await http.post('/api/v1/cases/carry-forward').set(auth2).send({ classSessionId: next, caseIds: [stay.id] }).expect(201)).body.created).toBe(0);
    const after = await http.get('/api/v1/cases').query({ classSessionId: next }).set(auth2).expect(200);
    expect(after.body.previous.cases.map((c: { id: string }) => c.id)).not.toContain(stay.id);

    // The patient moved bed today: an ordinary edit, yesterday's case untouched.
    await http.patch(`/api/v1/cases/${copy.id}`).set(auth2).send({ bed: '7' }).expect(200);
    expect((await prisma.patientCase.findUniqueOrThrow({ where: { id: stay.id } })).bed).toBe('3');

    // Only earlier days of the same section can be carried from.
    await http.post('/api/v1/cases/carry-forward').set(auth2).send({ classSessionId: sessionId, caseIds: [copy.id] }).expect(400);
  });
});
