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
});
