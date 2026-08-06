import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };
const LECTURER = { email: 'p.somchai@nursing.au.edu', password: 'ChangeMe!2026' };

/**
 * Curriculum hierarchy additions (Program.curriculumYearBE, Subject.category
 * /yearLevel) and the new Locations module (campuses — including external
 * clinical sites — and buildings).
 */
describe('Curriculum hierarchy + locations (integration, real Postgres)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let lecturerToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = request(app.getHttpServer());
    adminToken = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;
    lecturerToken = (await http.post('/api/v1/auth/login').send(LECTURER)).body.accessToken;
  });

  afterAll(async () => { await app?.close(); });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  describe('Program.curriculumYearBE', () => {
    it('round-trips through create and update', async () => {
      const programs = await http.get('/api/v1/programs').set(auth(adminToken)).expect(200);
      const facultyId = programs.body[0].faculty.id;

      const created = await http.post('/api/v1/programs').set(auth(adminToken))
        .send({ facultyId, code: 'E2E-CUR', nameEn: 'E2E Curriculum Program', curriculumYearBE: 2565 })
        .expect(201);
      expect(created.body.curriculumYearBE).toBe(2565);

      const updated = await http.patch(`/api/v1/programs/${created.body.id}`).set(auth(adminToken))
        .send({ curriculumYearBE: 2570 }).expect(200);
      expect(updated.body.curriculumYearBE).toBe(2570);
    });
  });

  describe('Subject.category / yearLevel', () => {
    it('round-trips and filters by both', async () => {
      const programs = await http.get('/api/v1/programs').set(auth(adminToken)).expect(200);
      const programId = programs.body[0].id;
      const courses = await http.get('/api/v1/courses').set(auth(adminToken)).expect(200);
      const courseId = courses.body.find((c: { programId: string }) => c.programId === programId)?.id
        ?? (await http.post('/api/v1/courses').set(auth(adminToken)).send({ programId, code: 'E2E-C', nameEn: 'E2E Course' }).expect(201)).body.id;

      const created = await http.post('/api/v1/subjects').set(auth(adminToken))
        .send({ programId, courseId, code: 'E2E-SUB1', nameEn: 'E2E Subject', category: 'PROFESSIONAL_PRACTICE', yearLevel: 3 })
        .expect(201);
      expect(created.body.category).toBe('PROFESSIONAL_PRACTICE');
      expect(created.body.yearLevel).toBe(3);

      const filtered = await http.get('/api/v1/subjects?category=PROFESSIONAL_PRACTICE&yearLevel=3').set(auth(adminToken)).expect(200);
      expect(filtered.body.items.map((s: { id: string }) => s.id)).toContain(created.body.id);

      const wrongYear = await http.get('/api/v1/subjects?category=PROFESSIONAL_PRACTICE&yearLevel=1').set(auth(adminToken)).expect(200);
      expect(wrongYear.body.items.map((s: { id: string }) => s.id)).not.toContain(created.body.id);
    });
  });

  describe('Locations — campuses (incl. clinical sites) and buildings', () => {
    let hospitalId: string;

    it('creates a clinical site with a non-default locationType', async () => {
      const res = await http.post('/api/v1/locations/campuses').set(auth(adminToken))
        .send({ code: 'E2E-HOSP', nameEn: 'E2E Teaching Hospital', locationType: 'HOSPITAL', city: 'Bangkok' })
        .expect(201);
      expect(res.body.locationType).toBe('HOSPITAL');
      hospitalId = res.body.id;
    });

    it('defaults locationType to CAMPUS when omitted', async () => {
      const res = await http.post('/api/v1/locations/campuses').set(auth(adminToken))
        .send({ code: 'E2E-MAIN', nameEn: 'E2E Main Campus' })
        .expect(201);
      expect(res.body.locationType).toBe('CAMPUS');
    });

    it('rejects a duplicate location code', async () => {
      await http.post('/api/v1/locations/campuses').set(auth(adminToken))
        .send({ code: 'E2E-HOSP', nameEn: 'Duplicate' })
        .expect(409);
    });

    it('lets a lecturer read locations but not create one', async () => {
      await http.get('/api/v1/locations/campuses').set(auth(lecturerToken)).expect(200);
      await http.post('/api/v1/locations/campuses').set(auth(lecturerToken))
        .send({ code: 'E2E-NOPE', nameEn: 'Should be blocked' }).expect(403);
    });

    it('creates a building under the clinical site and cannot delete the site while it has one', async () => {
      const building = await http.post('/api/v1/locations/buildings').set(auth(adminToken))
        .send({ campusId: hospitalId, code: 'WARD-A', nameEn: 'Ward A' })
        .expect(201);
      expect(building.body.campus.locationType).toBe('HOSPITAL');

      await http.delete(`/api/v1/locations/campuses/${hospitalId}`).set(auth(adminToken)).expect(409);

      await http.delete(`/api/v1/locations/buildings/${building.body.id}`).set(auth(adminToken)).expect(200);
      await http.delete(`/api/v1/locations/campuses/${hospitalId}`).set(auth(adminToken)).expect(200);
    });
  });
});
