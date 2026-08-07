import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };

/**
 * A score component (an exam worth 25 marks) is a rubric whose single item's
 * maxRating is the full mark, so the raw mark is entered as-is and the
 * weighting falls out of the arithmetic. That only works if the API accepts a
 * mark above the old hard-coded 5, accepts a half mark, and still refuses a
 * mark above the item's own maximum.
 */
describe('Score components / raw exam marks (integration, real Postgres)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let rubricId: string;
  let itemId: string;
  let studentId: string;
  let sectionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = request(app.getHttpServer());
    adminToken = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;

    // A 25-mark midterm: one section, one item scored out of 25.
    const rubric = await http.post('/api/v1/assessment/rubrics').set(auth()).send({
      code: 'E2E-THEORY-MID', nameEn: 'E2E Theory Mid-term', weightPercent: 25,
      sections: [{
        nameEn: 'E2E Theory Mid-term', weightPercent: 100,
        items: [{ textEn: 'E2E Theory Mid-term (out of 25)', weightPercent: 100, maxRating: 25 }],
      }],
    }).expect(201);
    rubricId = rubric.body.id;
    itemId = rubric.body.sections[0].items[0].id;

    const subjects = await http.get('/api/v1/subjects').set(auth()).expect(200);
    const programId: string = subjects.body.items[0].program.id;
    const courseId: string = subjects.body.items[0].course.id;

    // A dedicated subject, so rewriting its rubric config can't disturb the
    // seeded config other specs rely on. The code deliberately sorts last:
    // several specs still take subjects[0] of the shared list, and a code
    // sorting ahead of NUS2202 would silently re-point them here.
    const subject = await http.post('/api/v1/subjects').set(auth()).send({
      programId, courseId, code: 'ZZ-E2E-SCORE', nameEn: 'ZZ E2E Score Components',
    }).expect(201);
    const subjectId: string = subject.body.id;

    // This subject is graded by the one component under test, at its full 25%.
    await http.patch(`/api/v1/assessment/subjects/${subjectId}/rubric-config`).set(auth()).send({
      rubrics: [{ rubricId, weightPercent: 25, isActive: true }],
    }).expect(200);

    const semesters = await http.get('/api/v1/semesters').set(auth());
    const semesterId: string = semesters.body.find((s: { isCurrent: boolean }) => s.isCurrent)?.id ?? semesters.body[0].id;

    const section = await http.post('/api/v1/sections').set(auth())
      .send({ subjectId, semesterId, sectionNo: 'E2E-SCORE' }).expect(201);
    sectionId = section.body.id;

    const student = await http.post('/api/v1/students').set(auth()).send({
      studentCode: 'E2E-SCORE-01', nameEn: 'Score Component Student', programId,
    }).expect(201);
    studentId = student.body.id;
    await http.post('/api/v1/enrollments').set(auth()).send({ sectionId, studentId }).expect(201);
  });

  afterAll(async () => { await app?.close(); });

  // Lazy: adminToken is only assigned in beforeAll.
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('accepts a raw mark well above the old hard-coded ceiling of 5', async () => {
    const res = await http.post('/api/v1/assessment/evaluation').set(auth()).send({
      rubricId, studentId, sectionId, scores: [{ rubricItemId: itemId, rating: 23 }],
    }).expect(201);
    // 23 out of 25 = 92% of the component.
    expect(res.body.scorePercent).toBe(92);
  });

  it('accepts a half mark', async () => {
    const res = await http.post('/api/v1/assessment/evaluation').set(auth()).send({
      rubricId, studentId, sectionId, scores: [{ rubricItemId: itemId, rating: 23.5 }],
    }).expect(201);
    expect(res.body.scorePercent).toBe(94);
  });

  it("refuses a mark above the item's own maximum", async () => {
    await http.post('/api/v1/assessment/evaluation').set(auth()).send({
      rubricId, studentId, sectionId, scores: [{ rubricItemId: itemId, rating: 26 }],
    }).expect(400);
  });

  // The lab exam is sat two ways: every procedure, or one drawn at random.
  // One rubric has to serve both, so the score averages over what was
  // actually examined rather than treating undrawn procedures as zeros.
  describe('a multi-procedure checklist scored either way', () => {
    let labRubricId: string;
    let procA: string[];
    let procB: string[];

    beforeAll(async () => {
      const r = await http.post('/api/v1/assessment/rubrics').set(auth()).send({
        code: 'E2E-LAB-DRAW', nameEn: 'E2E Lab Draw', weightPercent: 7,
        sections: [
          { nameEn: 'Procedure A', weightPercent: 50, items: [
            { textEn: 'A step 1', weightPercent: 50, maxRating: 5 },
            { textEn: 'A step 2', weightPercent: 50, maxRating: 5 },
          ] },
          { nameEn: 'Procedure B', weightPercent: 50, items: [
            { textEn: 'B step 1', weightPercent: 50, maxRating: 5 },
            { textEn: 'B step 2', weightPercent: 50, maxRating: 5 },
          ] },
        ],
      }).expect(201);
      labRubricId = r.body.id;
      procA = r.body.sections[0].items.map((i: { id: string }) => i.id);
      procB = r.body.sections[1].items.map((i: { id: string }) => i.id);
    });

    it('gives full marks for a drawn procedure done perfectly, ignoring the undrawn one', async () => {
      const res = await http.post('/api/v1/assessment/evaluation').set(auth()).send({
        rubricId: labRubricId, studentId, sectionId,
        scores: procA.map((id) => ({ rubricItemId: id, rating: 5 })),
      }).expect(201);
      expect(res.body.scorePercent).toBe(100);
    });

    it('gives the same full marks when every procedure is performed', async () => {
      const res = await http.post('/api/v1/assessment/evaluation').set(auth()).send({
        rubricId: labRubricId, studentId, sectionId,
        scores: [...procA, ...procB].map((id) => ({ rubricItemId: id, rating: 5 })),
      }).expect(201);
      expect(res.body.scorePercent).toBe(100);
    });

    it('still counts a deliberate 0 against the student', async () => {
      const res = await http.post('/api/v1/assessment/evaluation').set(auth()).send({
        rubricId: labRubricId, studentId, sectionId,
        scores: [{ rubricItemId: procA[0], rating: 5 }, { rubricItemId: procA[1], rating: 0 }],
      }).expect(201);
      expect(res.body.scorePercent).toBe(50);
    });

    it('averages across procedures when both are examined unevenly', async () => {
      const res = await http.post('/api/v1/assessment/evaluation').set(auth()).send({
        rubricId: labRubricId, studentId, sectionId,
        scores: [
          ...procA.map((id) => ({ rubricItemId: id, rating: 5 })),   // 100%
          ...procB.map((id) => ({ rubricItemId: id, rating: 3 })),   // 60%
        ],
      }).expect(201);
      expect(res.body.scorePercent).toBe(80);
    });
  });

  it('weights the component into the student total at its subject weight', async () => {
    await http.post('/api/v1/assessment/evaluation').set(auth()).send({
      rubricId, studentId, sectionId, scores: [{ rubricItemId: itemId, rating: 23 }],
    }).expect(201);

    const summary = await http.get(`/api/v1/assessment/students/${studentId}/summary?sectionId=${sectionId}`)
      .set(auth()).expect(200);
    const row = summary.body.rubrics.find((r: { rubricId: string }) => r.rubricId === rubricId);
    expect(row).toBeDefined();
    // A 25%-weighted component scored 92% contributes exactly the raw mark, 23.
    expect(row.contribution).toBe(23);
  });
});
