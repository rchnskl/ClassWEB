import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };
const LECTURER = { email: 'p.somchai@nursing.au.edu', password: 'ChangeMe!2026' };

/** supertest parses text by default; binary downloads need collecting by hand. */
function binaryParser(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

/** Builds an in-memory .xlsx matching the import template's headers. */
async function sheet(rows: (string | number)[][], header = ['Student code', 'Name (EN)', 'Name (TH)', 'Gender', 'Year']) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students');
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Central roster, Excel import and groups (integration, real Postgres)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let lecturerToken: string;
  let programId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = request(app.getHttpServer());

    const login = (b: { email: string; password: string }) => http.post('/api/v1/auth/login').send(b);
    adminToken = (await login(ADMIN)).body.accessToken;
    lecturerToken = (await login(LECTURER)).body.accessToken;
    programId = (await http.get('/api/v1/programs').set(auth(adminToken)).expect(200)).body[0].id;
  });

  afterAll(async () => { await app?.close(); });

  // ---- import ------------------------------------------------------------

  describe('Excel import', () => {
    it('serves a template whose headers its own parser accepts', async () => {
      const res = await http.get('/api/v1/students/import/template.xlsx')
        .set(auth(adminToken))
        .buffer()
        .parse(binaryParser)
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect((res.body as Buffer).length).toBeGreaterThan(0);

      // Feed the template straight back in: this is the contract between the
      // file we hand out and the parser that has to read it back.
      const back = await http.post('/api/v1/students/import')
        .set(auth(adminToken))
        .field('programId', programId)
        .attach('file', res.body as Buffer, 'template.xlsx')
        .expect(201);
      expect(back.body.committed).toBe(false);
      // The two example rows parse cleanly — no header/format errors.
      expect(back.body.totalRows).toBe(2);
      expect(back.body.errors).toBe(0);
    });

    it('previews without writing anything, and reports per-row errors with row numbers', async () => {
      const file = await sheet([
        ['E2E-R-001', 'VALID STUDENT', 'นักศึกษา ทดสอบ', 'MS.', 2],
        ['', 'MISSING CODE', '', 'MR.', 2],          // row 3 — no code
        ['E2E-R-003', '', '', 'MR.', 2],             // row 4 — no name
        ['E2E-R-001', 'DUPLICATE IN FILE', '', '', 2], // row 5 — dup of row 2
      ]);
      const res = await http.post('/api/v1/students/import')
        .set(auth(adminToken))
        .field('programId', programId)
        .attach('file', file, 'roster.xlsx')
        .expect(201);

      expect(res.body.committed).toBe(false);
      expect(res.body.totalRows).toBe(4);
      expect(res.body.errors).toBe(3);
      const byRow = Object.fromEntries(res.body.rows.map((r: { row: number; errors: string[] }) => [r.row, r.errors]));
      expect(byRow[3].join()).toMatch(/code is missing/i);
      expect(byRow[4].join()).toMatch(/name.*missing/i);
      expect(byRow[5].join()).toMatch(/duplicate of row 2/i);

      // Nothing may have been written by a preview.
      const check = await http.get('/api/v1/students?search=E2E-R-001').set(auth(adminToken)).expect(200);
      expect(check.body.items).toHaveLength(0);
    });

    it('refuses to commit a file that still has errors (never half-imports)', async () => {
      const file = await sheet([
        ['E2E-R-010', 'GOOD ROW', '', 'MS.', 2],
        ['', 'BAD ROW', '', '', 2],
      ]);
      await http.post('/api/v1/students/import')
        .set(auth(adminToken))
        .field('programId', programId).field('commit', 'true')
        .attach('file', file, 'roster.xlsx')
        .expect(400);

      const check = await http.get('/api/v1/students?search=E2E-R-010').set(auth(adminToken)).expect(200);
      expect(check.body.items).toHaveLength(0);
    });

    it('commits a clean file, applies the fallback year, and is idempotent on re-run', async () => {
      const file = await sheet([
        ['E2E-R-101', 'ALPHA ONE', 'อัลฟ่า หนึ่ง', 'MS.', ''],
        ['E2E-R-102', 'BETA TWO', '', 'MR.', ''],
      ]);
      const first = await http.post('/api/v1/students/import')
        .set(auth(adminToken))
        .field('programId', programId).field('yearLevel', '3').field('commit', 'true')
        .attach('file', file, 'roster.xlsx')
        .expect(201);
      expect(first.body.committed).toBe(true);
      expect(first.body.toCreate).toBe(2);
      expect(first.body.importBatch).toMatch(/^IMP-\d{8}-[0-9A-F]{6}$/);

      const listed = await http.get('/api/v1/students?search=E2E-R-10&yearLevel=3').set(auth(adminToken)).expect(200);
      expect(listed.body.items.map((s: { studentCode: string }) => s.studentCode).sort())
        .toEqual(['E2E-R-101', 'E2E-R-102']);
      expect(listed.body.items.every((s: { yearLevel: number }) => s.yearLevel === 3)).toBe(true);

      // Second run with the default SKIP mode changes nothing.
      const again = await http.post('/api/v1/students/import')
        .set(auth(adminToken))
        .field('programId', programId).field('yearLevel', '3').field('commit', 'true')
        .attach('file', await sheet([['E2E-R-101', 'ALPHA ONE', '', 'MS.', '']]), 'roster.xlsx')
        .expect(201);
      expect(again.body.toSkip).toBe(1);
      expect(again.body.toCreate).toBe(0);
    });

    it('keeps a numeric-looking student code as text (no float/scientific mangling)', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Students');
      ws.addRow(['Student code', 'Name (EN)']);
      ws.addRow([6812999, 'NUMERIC CODE STUDENT']); // genuine number cell
      const file = Buffer.from(await wb.xlsx.writeBuffer());

      await http.post('/api/v1/students/import')
        .set(auth(adminToken))
        .field('programId', programId).field('yearLevel', '1').field('commit', 'true')
        .attach('file', file, 'roster.xlsx')
        .expect(201);

      const res = await http.get('/api/v1/students?search=6812999').set(auth(adminToken)).expect(200);
      expect(res.body.items[0].studentCode).toBe('6812999');
    });

    it('rejects a file whose headers it cannot understand', async () => {
      const file = await sheet([['x', 'y']], ['Foo', 'Bar']);
      await http.post('/api/v1/students/import')
        .set(auth(adminToken)).field('programId', programId)
        .attach('file', file, 'roster.xlsx')
        .expect(400);
    });

    it('forbids a lecturer from importing a roster', async () => {
      const file = await sheet([['E2E-R-900', 'NOPE', '', '', 1]]);
      await http.post('/api/v1/students/import')
        .set(auth(lecturerToken)).field('programId', programId)
        .attach('file', file, 'roster.xlsx')
        .expect(403);
    });
  });

  // ---- central lookup ----------------------------------------------------

  describe('central roster lookup', () => {
    it('lets a lecturer find a student they do not teach (so they can add them)', async () => {
      const res = await http.get('/api/v1/students/lookup?q=E2E-R-101').set(auth(lecturerToken)).expect(200);
      expect(res.body.map((s: { studentCode: string }) => s.studentCode)).toContain('E2E-R-101');
    });

    it('never exposes contact or identity-document fields', async () => {
      const res = await http.get('/api/v1/students/lookup?q=E2E-R-101').set(auth(lecturerToken)).expect(200);
      const keys = Object.keys(res.body[0]);
      expect(keys).not.toContain('email');
      expect(keys).not.toContain('phone');
      expect(keys).not.toContain('citizenId');
      expect(keys).not.toContain('birthDate');
    });

    it('also finds them via the lecturer\'s own /students list (reads are tenant-wide, not section-scoped)', async () => {
      const res = await http.get('/api/v1/students?search=E2E-R-101').set(auth(lecturerToken)).expect(200);
      expect(res.body.items.map((s: { studentCode: string }) => s.studentCode)).toContain('E2E-R-101');
    });

    it('refuses an unfiltered call so it cannot be used to dump the roster', async () => {
      await http.get('/api/v1/students/lookup').set(auth(lecturerToken)).expect(400);
      await http.get('/api/v1/students/lookup?q=a').set(auth(lecturerToken)).expect(400);
    });
  });

  // ---- groups ------------------------------------------------------------

  describe('groups', () => {
    let cohortProgramId: string;

    beforeAll(async () => {
      cohortProgramId = programId;
      // A 7-student cohort in year 5 (unused elsewhere) to split.
      const rows = Array.from({ length: 7 }, (_, i) => [`E2E-G-${String(i + 1).padStart(3, '0')}`, `GROUP MEMBER ${i + 1}`, '', 'MS.', 5]);
      await http.post('/api/v1/students/import')
        .set(auth(adminToken))
        .field('programId', cohortProgramId).field('commit', 'true')
        .attach('file', await sheet(rows), 'cohort.xlsx')
        .expect(201);
    });

    it('auto-splits a cohort into groups whose sizes differ by at most one', async () => {
      const res = await http.post('/api/v1/student-groups/auto-split').set(auth(adminToken)).send({
        groupCount: 3, scope: 'CENTRAL', programId: cohortProgramId, yearLevel: 5,
        namePrefixEn: 'E2E Lab', namePrefixTh: 'อี2อี กลุ่ม',
      }).expect(201);

      expect(res.body.totalStudents).toBe(7);
      const sizes = res.body.groups.map((g: { _count: { members: number } }) => g._count.members).sort();
      expect(sizes).toEqual([2, 2, 3]); // 7 into 3 → 3/2/2, never 2/2/3-with-a-remainder-group
      expect(sizes.reduce((a: number, b: number) => a + b, 0)).toBe(7);
    });

    it('forbids a lecturer from creating a central (faculty-wide) group', async () => {
      await http.post('/api/v1/student-groups').set(auth(lecturerToken))
        .send({ scope: 'CENTRAL', nameEn: 'Lecturer central group', programId: cohortProgramId, yearLevel: 5 })
        .expect(403);
    });

    it('lets a lecturer read central groups (they are shared by design)', async () => {
      const res = await http.get('/api/v1/student-groups?scope=CENTRAL&yearLevel=5').set(auth(lecturerToken)).expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('adds and removes members manually, ignoring ids that are already in', async () => {
      const group = (await http.post('/api/v1/student-groups').set(auth(adminToken))
        .send({ scope: 'CENTRAL', nameEn: 'E2E Manual Group', programId: cohortProgramId, yearLevel: 5 })
        .expect(201)).body;

      const students = (await http.get('/api/v1/students?search=E2E-G-&yearLevel=5&take=10').set(auth(adminToken)).expect(200)).body.items;
      const ids = students.slice(0, 3).map((s: { id: string }) => s.id);

      const added = await http.post(`/api/v1/student-groups/${group.id}/members`).set(auth(adminToken))
        .send({ studentIds: ids }).expect(201);
      expect(added.body.added).toBe(3);

      const twice = await http.post(`/api/v1/student-groups/${group.id}/members`).set(auth(adminToken))
        .send({ studentIds: ids }).expect(201);
      expect(twice.body.added).toBe(0);
      expect(twice.body.alreadyMembers).toBe(3);

      await http.delete(`/api/v1/student-groups/${group.id}/members/${ids[0]}`).set(auth(adminToken)).expect(200);
      const detail = await http.get(`/api/v1/student-groups/${group.id}`).set(auth(adminToken)).expect(200);
      expect(detail.body.members).toHaveLength(2);
    });
  });

  // ---- enrolment rules ---------------------------------------------------

  describe('enrolment rules', () => {
    let sectionA: string;
    let sectionB: string;
    let studentId: string;

    beforeAll(async () => {
      const subjects = await http.get('/api/v1/subjects').set(auth(adminToken)).expect(200);
      const subjectId = subjects.body.items[0].id;
      const semesters = await http.get('/api/v1/semesters').set(auth(adminToken)).expect(200);
      const semesterId = semesters.body.find((s: { isCurrent: boolean }) => s.isCurrent)?.id ?? semesters.body[0].id;

      sectionA = (await http.post('/api/v1/sections').set(auth(adminToken))
        .send({ subjectId, semesterId, sectionNo: 'E2E-RA' }).expect(201)).body.id;
      sectionB = (await http.post('/api/v1/sections').set(auth(adminToken))
        .send({ subjectId, semesterId, sectionNo: 'E2E-RB' }).expect(201)).body.id;

      studentId = (await http.get('/api/v1/students?search=E2E-R-101').set(auth(adminToken)).expect(200)).body.items[0].id;
    });

    it('blocks a second section of the same subject in the same semester', async () => {
      await http.post('/api/v1/enrollments').set(auth(adminToken))
        .send({ sectionId: sectionA, studentId }).expect(201);

      const clash = await http.post('/api/v1/enrollments').set(auth(adminToken))
        .send({ sectionId: sectionB, studentId }).expect(409);
      expect(clash.body.message).toMatch(/already enrolled in/i);
    });

    it('reports per-student outcomes when bulk-enrolling a group', async () => {
      const group = (await http.post('/api/v1/student-groups').set(auth(adminToken))
        .send({ scope: 'CENTRAL', nameEn: 'E2E Enrol Group', programId, yearLevel: 5 }).expect(201)).body;
      const members = (await http.get('/api/v1/students?search=E2E-G-&yearLevel=5&take=10').set(auth(adminToken)).expect(200)).body.items;
      await http.post(`/api/v1/student-groups/${group.id}/members`).set(auth(adminToken))
        .send({ studentIds: members.slice(0, 3).map((s: { id: string }) => s.id) }).expect(201);

      const res = await http.post(`/api/v1/student-groups/${group.id}/enroll`).set(auth(adminToken))
        .send({ sectionId: sectionB }).expect(201);
      expect(res.body.enrolled).toBe(3);
      expect(res.body.skipped).toHaveLength(0);

      // Re-running reports every member as skipped rather than throwing.
      const repeat = await http.post(`/api/v1/student-groups/${group.id}/enroll`).set(auth(adminToken))
        .send({ sectionId: sectionB }).expect(201);
      expect(repeat.body.enrolled).toBe(0);
      expect(repeat.body.skipped).toHaveLength(3);
    });
  });

  // ---- year promotion ----------------------------------------------------

  describe('year promotion', () => {
    it('dry-runs by default and reports the affected count without writing', async () => {
      const res = await http.post('/api/v1/students/promote-year').set(auth(adminToken))
        .send({ fromYear: 3, finalYear: 4 }).expect(201);
      expect(res.body.committed).toBe(false);
      expect(res.body.affected).toBeGreaterThanOrEqual(2);

      const still = await http.get('/api/v1/students?search=E2E-R-101&yearLevel=3').set(auth(adminToken)).expect(200);
      expect(still.body.items).toHaveLength(1);
    });

    it('advances the cohort when committed', async () => {
      await http.post('/api/v1/students/promote-year').set(auth(adminToken))
        .send({ fromYear: 3, finalYear: 4, commit: true }).expect(201);

      const moved = await http.get('/api/v1/students?search=E2E-R-101&yearLevel=4').set(auth(adminToken)).expect(200);
      expect(moved.body.items).toHaveLength(1);
    });

    it('graduates the final year instead of advancing past the curriculum', async () => {
      const res = await http.post('/api/v1/students/promote-year').set(auth(adminToken))
        .send({ fromYear: 4, finalYear: 4, commit: true }).expect(201);
      expect(res.body.graduating).toBe(true);

      const grad = await http.get('/api/v1/students?search=E2E-R-101').set(auth(adminToken)).expect(200);
      expect(grad.body.items[0].status).toBe('GRADUATED');
    });

    it('forbids a lecturer from promoting a cohort', async () => {
      await http.post('/api/v1/students/promote-year').set(auth(lecturerToken))
        .send({ fromYear: 1, finalYear: 4 }).expect(403);
    });
  });
});
