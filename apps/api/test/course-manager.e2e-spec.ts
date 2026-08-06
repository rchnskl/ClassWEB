import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };
const LECTURER1 = { email: 'p.somchai@nursing.au.edu', password: 'ChangeMe!2026' };

/**
 * The Course Manager / Team Member subject-membership model: self-join with
 * a chosen role, the 2-manager cap, section-creation gating, cross-cutting
 * visibility scoping (lecturers directory, timetable writes, analytics,
 * grading), and the cross-section grade-edit notification/audit trail.
 */
describe('Course Manager / Team Member (integration, real Postgres)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  let adminToken: string;
  let lecturer1Token: string;
  let lecturer2Token: string;
  let lecturer3Token: string;
  let lecturer1Id: string;
  let lecturer2Id: string;
  let lecturer3Id: string;
  let subjectId: string;
  let semesterId: string;

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

    // Two fresh lecturers dedicated to this suite, isolated from other specs.
    const l2 = await http.post('/api/v1/lecturers').set(auth(adminToken)).send({
      employeeCode: 'EMP-CM-02', nameEn: 'Dr. CourseManager Two', email: 'cm2.e2e@nursing.au.edu',
    }).expect(201);
    lecturer2Id = l2.body.id;
    lecturer2Token = (await login({ email: 'cm2.e2e@nursing.au.edu', password: l2.body.tempPassword })).body.accessToken;

    const l3 = await http.post('/api/v1/lecturers').set(auth(adminToken)).send({
      employeeCode: 'EMP-CM-03', nameEn: 'Dr. CourseManager Three', email: 'cm3.e2e@nursing.au.edu',
    }).expect(201);
    lecturer3Id = l3.body.id;
    lecturer3Token = (await login({ email: 'cm3.e2e@nursing.au.edu', password: l3.body.tempPassword })).body.accessToken;

    const me1 = await http.get('/api/v1/users/me').set(auth(lecturer1Token)).expect(200);
    lecturer1Id = me1.body.lecturer?.id ?? me1.body.lecturerId;

    // A dedicated subject, isolated from every other spec file — joining it
    // as course manager here must not leak into another file's assumptions
    // about who manages/teaches the shared seed subjects.
    const existingSubjects = await http.get('/api/v1/subjects').set(auth(adminToken)).expect(200);
    const programId: string = existingSubjects.body.items[0].program.id;
    const courseId: string = existingSubjects.body.items[0].course.id;
    const subject = await http.post('/api/v1/subjects').set(auth(adminToken)).send({
      programId, courseId, code: 'E2E-CM-SUBJ', nameEn: 'E2E Course Manager Subject',
    }).expect(201);
    subjectId = subject.body.id;

    const semesters = await http.get('/api/v1/semesters').set(auth(adminToken));
    semesterId = semesters.body.find((s: { isCurrent: boolean }) => s.isCurrent)?.id ?? semesters.body[0].id;
  });

  afterAll(async () => { await app?.close(); });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('joining a subject', () => {
    it('lets a lecturer self-join as TEAM_MEMBER', async () => {
      const res = await http.post(`/api/v1/subjects/${subjectId}/join`).set(auth(lecturer3Token))
        .send({ role: 'TEAM_MEMBER' }).expect(201);
      expect(res.body.role).toBe('TEAM_MEMBER');
    });

    it('blocks joining the same subject twice', async () => {
      await http.post(`/api/v1/subjects/${subjectId}/join`).set(auth(lecturer3Token))
        .send({ role: 'TEAM_MEMBER' }).expect(409);
    });

    it('lets a different lecturer self-join as COURSE_MANAGER', async () => {
      const res = await http.post(`/api/v1/subjects/${subjectId}/join`).set(auth(lecturer1Token))
        .send({ role: 'COURSE_MANAGER' }).expect(201);
      expect(res.body.role).toBe('COURSE_MANAGER');
    });

    it('allows a second course manager (cap is 2)', async () => {
      const res = await http.post(`/api/v1/subjects/${subjectId}/join`).set(auth(lecturer2Token))
        .send({ role: 'COURSE_MANAGER' }).expect(201);
      expect(res.body.role).toBe('COURSE_MANAGER');
    });

    it('blocks a third course manager for the same subject', async () => {
      const l4 = await http.post('/api/v1/lecturers').set(auth(adminToken)).send({
        employeeCode: 'EMP-CM-04', nameEn: 'Dr. CourseManager Four', email: 'cm4.e2e@nursing.au.edu',
      }).expect(201);
      const l4Token = (await http.post('/api/v1/auth/login').send({ email: 'cm4.e2e@nursing.au.edu', password: l4.body.tempPassword })).body.accessToken;
      await http.post(`/api/v1/subjects/${subjectId}/join`).set(auth(l4Token))
        .send({ role: 'COURSE_MANAGER' }).expect(409);
    });

    it('reports the memberships back via /subjects/mine/memberships', async () => {
      const res = await http.get('/api/v1/subjects/mine/memberships').set(auth(lecturer1Token)).expect(200);
      expect(res.body.managed).toContain(subjectId);
      expect(res.body.member).toContain(subjectId);
    });
  });

  describe('team management', () => {
    let teamMemberLecturerId: string;

    beforeAll(async () => {
      const l5 = await http.post('/api/v1/lecturers').set(auth(adminToken)).send({
        employeeCode: 'EMP-CM-05', nameEn: 'Dr. CourseManager Five', email: 'cm5.e2e@nursing.au.edu',
      }).expect(201);
      teamMemberLecturerId = l5.body.id;
    });

    it('lets a course manager pull a lecturer into the team directly', async () => {
      const res = await http.post(`/api/v1/subjects/${subjectId}/team`).set(auth(lecturer1Token))
        .send({ lecturerId: teamMemberLecturerId, role: 'TEAM_MEMBER' }).expect(201);
      expect(res.body.role).toBe('TEAM_MEMBER');
    });

    it('blocks that lecturer from being pulled into the same subject twice', async () => {
      await http.post(`/api/v1/subjects/${subjectId}/team`).set(auth(lecturer1Token))
        .send({ lecturerId: teamMemberLecturerId, role: 'TEAM_MEMBER' }).expect(409);
    });

    it('a non-manager cannot pull lecturers into the team', async () => {
      await http.post(`/api/v1/subjects/${subjectId}/team`).set(auth(lecturer3Token))
        .send({ lecturerId: teamMemberLecturerId, role: 'TEAM_MEMBER' }).expect(403);
    });

    it('lists the full team', async () => {
      const res = await http.get(`/api/v1/subjects/${subjectId}/members`).set(auth(lecturer1Token)).expect(200);
      const lecturerIds = res.body.map((m: { lecturer: { id: string } }) => m.lecturer.id);
      expect(lecturerIds).toContain(lecturer1Id);
      expect(lecturerIds).toContain(lecturer2Id);
      expect(lecturerIds).toContain(teamMemberLecturerId);
    });
  });

  describe('section creation is gated by course-manager membership', () => {
    it('a TEAM_MEMBER cannot create a section for the subject', async () => {
      await http.post('/api/v1/sections').set(auth(lecturer3Token))
        .send({ subjectId, semesterId, sectionNo: 'E2E-CM-TM' }).expect(403);
    });

    it('a lecturer with no membership at all cannot create a section either', async () => {
      const outsider = await http.post('/api/v1/lecturers').set(auth(adminToken)).send({
        employeeCode: 'EMP-CM-OUT', nameEn: 'Dr. Outsider', email: 'outsider.e2e@nursing.au.edu',
      }).expect(201);
      const outsiderToken = (await http.post('/api/v1/auth/login').send({ email: 'outsider.e2e@nursing.au.edu', password: outsider.body.tempPassword })).body.accessToken;
      await http.post('/api/v1/sections').set(auth(outsiderToken))
        .send({ subjectId, semesterId, sectionNo: 'E2E-CM-OUT' }).expect(403);
    });

    it('a COURSE_MANAGER can create a section and assign any lecturer as teacher', async () => {
      const res = await http.post('/api/v1/sections').set(auth(lecturer1Token))
        .send({ subjectId, semesterId, sectionNo: 'E2E-CM-01', lecturerId: lecturer2Id }).expect(201);
      expect(res.body.lecturer.id).toBe(lecturer2Id);
    });
  });

  describe('cross-cutting scope: lecturers directory, timetable, analytics, grading', () => {
    let managedSectionId: string;

    beforeAll(async () => {
      const res = await http.post('/api/v1/sections').set(auth(lecturer1Token))
        .send({ subjectId, semesterId, sectionNo: 'E2E-CM-SCOPE', lecturerId: lecturer2Id }).expect(201);
      managedSectionId = res.body.id;
    });

    it('lecturer1 (manager) sees lecturer2 (teammate on the same subject) in the directory', async () => {
      const res = await http.get('/api/v1/lecturers?take=200').set(auth(lecturer1Token)).expect(200);
      const ids = res.body.items.map((l: { id: string }) => l.id);
      expect(ids).toContain(lecturer2Id);
    });

    it('lecturer1 (manager, not the section\'s own teacher) can set the section\'s schedule', async () => {
      await http.post('/api/v1/timetable/schedules').set(auth(lecturer1Token))
        .send({ sectionId: managedSectionId, dayOfWeek: 'WEDNESDAY', startTime: '09:00', endTime: '11:00' }).expect(201);
    });

    it('an unrelated lecturer cannot set that section\'s schedule', async () => {
      await http.post('/api/v1/timetable/schedules').set(auth(lecturer3Token))
        .send({ sectionId: managedSectionId, dayOfWeek: 'THURSDAY', startTime: '09:00', endTime: '11:00' }).expect(403);
    });

    it("lecturer1 (manager) can view the section's grade sheet even though lecturer2 is the assigned teacher", async () => {
      await http.get(`/api/v1/assessment/sections/${managedSectionId}/summary`).set(auth(lecturer1Token)).expect(200);
    });

    it('an unrelated lecturer cannot view that grade sheet', async () => {
      await http.get(`/api/v1/assessment/sections/${managedSectionId}/summary`).set(auth(lecturer3Token)).expect(403);
    });

    it('analytics overview does not error for a scoped lecturer', async () => {
      const res = await http.get('/api/v1/analytics/overview').set(auth(lecturer1Token)).expect(200);
      expect(res.body).toHaveProperty('totals');
    });
  });
});
