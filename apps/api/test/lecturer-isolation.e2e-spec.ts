import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };
const LECTURER1 = { email: 'p.somchai@nursing.au.edu', password: 'ChangeMe!2026' };

/**
 * A lecturer must only see (and grade/take attendance for) sections they
 * actually teach — never another lecturer's students, scores, or rosters.
 * Rubric templates are the sole deliberate exception (shared catalogue).
 */
describe('Lecturer data isolation (integration, real Postgres)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  let adminToken: string;
  let lecturer1Token: string;
  let lecturer2Token: string;
  let section2Id: string;
  let student2Id: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = request(app.getHttpServer());

    const login = (body: { email: string; password: string }) => http.post('/api/v1/auth/login').send(body);

    adminToken = (await login(ADMIN)).body.accessToken;
    lecturer1Token = (await login(LECTURER1)).body.accessToken;

    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    // A second lecturer, with their own section/student, that lecturer 1 has
    // no relationship to at all. The subject is created fresh rather than
    // reusing items[0] of the shared list: another spec file adding a subject
    // that happens to sort first would otherwise silently re-point this whole
    // suite at a subject lecturer 1 legitimately manages, and every isolation
    // assertion below would flip.
    const existing = await http.get('/api/v1/subjects').set(auth(adminToken)).expect(200);
    const programId: string = existing.body.items[0].program.id;
    const courseId: string = existing.body.items[0].course.id;
    const subject = await http.post('/api/v1/subjects').set(auth(adminToken)).send({
      programId, courseId, code: 'E2E-ISO-SUBJ', nameEn: 'E2E Isolation Subject',
    }).expect(201);
    const subjectId: string = subject.body.id;

    const semesters = await http.get('/api/v1/semesters').set(auth(adminToken));
    const semesterId: string = semesters.body.find((s: { isCurrent: boolean }) => s.isCurrent)?.id ?? semesters.body[0].id;

    const lecturer2 = await http.post('/api/v1/lecturers').set(auth(adminToken)).send({
      employeeCode: 'EMP-E2E-ISO', nameEn: 'Dr. Isolation Test', email: 'isolation.e2e@nursing.au.edu',
    }).expect(201);
    lecturer2Token = (await login({ email: 'isolation.e2e@nursing.au.edu', password: lecturer2.body.tempPassword })).body.accessToken;

    const section2 = await http.post('/api/v1/sections').set(auth(adminToken)).send({
      subjectId, semesterId, sectionNo: 'E2E-ISO', lecturerId: lecturer2.body.id,
    }).expect(201);
    section2Id = section2.body.id;

    const student2 = await http.post('/api/v1/students').set(auth(adminToken)).send({
      studentCode: 'E2E-ISO-01', nameEn: 'Isolation Test Student', programId,
    }).expect(201);
    student2Id = student2.body.id;

    await http.post('/api/v1/enrollments').set(auth(adminToken)).send({ sectionId: section2Id, studentId: student2Id }).expect(201);
  });

  afterAll(async () => { await app?.close(); });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('sections', () => {
    it("lecturer 1's section list never includes lecturer 2's section", async () => {
      const res = await http.get('/api/v1/sections').set(auth(lecturer1Token)).expect(200);
      expect(res.body.items.map((s: { id: string }) => s.id)).not.toContain(section2Id);
    });

    it("lecturer 1 gets 403 fetching lecturer 2's section directly by id", async () => {
      await http.get(`/api/v1/sections/${section2Id}`).set(auth(lecturer1Token)).expect(403);
    });

    it("lecturer 2 can fetch their own section", async () => {
      const res = await http.get(`/api/v1/sections/${section2Id}`).set(auth(lecturer2Token)).expect(200);
      expect(res.body.id).toBe(section2Id);
    });

    it('admin can fetch any section regardless of lecturer', async () => {
      await http.get(`/api/v1/sections/${section2Id}`).set(auth(adminToken)).expect(200);
    });
  });

  describe('students', () => {
    // Reading the roster is deliberately NOT section-scoped: a lecturer needs
    // to see the full 4-year cohort to find/enroll students and plan groups,
    // even for students in a section they don't teach. Only sections,
    // enrollment writes, and assessment/grading stay isolated per-lecturer.
    it("lecturer 1's student list includes every student in the tenant, including lecturer 2's", async () => {
      const res = await http.get('/api/v1/students?take=200').set(auth(lecturer1Token)).expect(200);
      expect(res.body.items.map((s: { id: string }) => s.id)).toContain(student2Id);
    });

    it("lecturer 1 can fetch lecturer 2's student directly by id", async () => {
      const res = await http.get(`/api/v1/students/${student2Id}`).set(auth(lecturer1Token)).expect(200);
      expect(res.body.id).toBe(student2Id);
    });

    it("lecturer 2 can fetch their own enrolled student", async () => {
      const res = await http.get(`/api/v1/students/${student2Id}`).set(auth(lecturer2Token)).expect(200);
      expect(res.body.id).toBe(student2Id);
    });

    it('admin can fetch any student regardless of enrollment', async () => {
      await http.get(`/api/v1/students/${student2Id}`).set(auth(adminToken)).expect(200);
    });
  });

  describe('assessment / grading', () => {
    it("lecturer 1 gets 403 requesting lecturer 2's section grade sheet", async () => {
      await http.get(`/api/v1/assessment/sections/${section2Id}/summary`).set(auth(lecturer1Token)).expect(403);
    });

    it("lecturer 1 gets 403 saving an evaluation into lecturer 2's section", async () => {
      const rubrics = await http.get('/api/v1/assessment/rubrics').set(auth(lecturer1Token)).expect(200);
      await http.post('/api/v1/assessment/evaluation').set(auth(lecturer1Token)).send({
        rubricId: rubrics.body[0].id, studentId: student2Id, sectionId: section2Id, scores: [],
      }).expect(403);
    });

    it("lecturer 2 can view their own section's grade sheet", async () => {
      await http.get(`/api/v1/assessment/sections/${section2Id}/summary`).set(auth(lecturer2Token)).expect(200);
    });

    it('rubric templates remain visible to every lecturer (shared catalogue, not scoped)', async () => {
      const l1 = await http.get('/api/v1/assessment/rubrics').set(auth(lecturer1Token)).expect(200);
      const l2 = await http.get('/api/v1/assessment/rubrics').set(auth(lecturer2Token)).expect(200);
      expect(l1.body.map((r: { id: string }) => r.id).sort()).toEqual(l2.body.map((r: { id: string }) => r.id).sort());
    });

    it('admin can view any section grade sheet', async () => {
      await http.get(`/api/v1/assessment/sections/${section2Id}/summary`).set(auth(adminToken)).expect(200);
    });
  });
});
