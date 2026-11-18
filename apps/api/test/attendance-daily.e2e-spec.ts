import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };

/** The daily attendance overview: per class day counts and rate, and a student × day grid. */
describe('Daily attendance overview', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let token: string;

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
  });
  afterAll(async () => { await app?.close(); });

  it('counts each day and each student, and exports the same to Excel', async () => {
    const base = await prisma.section.findFirstOrThrow({ where: { enrollments: { some: {} } } });
    const sec = await prisma.section.create({ data: { universityId: base.universityId, subjectId: base.subjectId, semesterId: base.semesterId, sectionNo: `D${Date.now() % 10000}` } });
    const any = await prisma.student.findFirstOrThrow({ where: { universityId: base.universityId } });
    const stamp = Date.now() % 100000;
    const students = await Promise.all([1, 2, 3].map((n) => prisma.student.create({
      data: { universityId: base.universityId, programId: any.programId, studentCode: `DA${stamp}${n}`, nameEn: `Daily ${n}` },
    })));
    const enr = await Promise.all(students.map((s) => prisma.enrollment.create({ data: { sectionId: sec.id, studentId: s.id } })));
    const d1 = await prisma.classSession.create({ data: { sectionId: sec.id, sessionDate: new Date('2026-11-02T00:00:00Z'), startTime: '14:15', endTime: '18:15' } });
    const d2 = await prisma.classSession.create({ data: { sectionId: sec.id, sessionDate: new Date('2026-11-09T00:00:00Z'), startTime: '14:15', endTime: '18:15' } });
    await prisma.classSession.create({ data: { sectionId: sec.id, sessionDate: new Date('2099-01-05T00:00:00Z'), startTime: '14:15', endTime: '18:15' } });
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } });
    const mark = (cs: string, i: number, status: 'PRESENT' | 'LATE' | 'ABSENT', by: 'admin' | 'qr' | null = null) =>
      prisma.attendanceRecord.create({ data: {
        classSessionId: cs, enrollmentId: enr[i].id, studentId: students[i].id, status,
        method: by === 'qr' ? 'QR_CODE' : 'MANUAL', recordedById: by === 'admin' ? admin.id : null,
      } });
    await mark(d1.id, 0, 'PRESENT', 'qr'); await mark(d1.id, 1, 'LATE', 'qr'); await mark(d1.id, 2, 'ABSENT', 'admin');
    await mark(d2.id, 0, 'PRESENT'); await mark(d2.id, 1, 'PRESENT'); // student 3 not recorded on day 2

    const r = await http.get(`/api/v1/attendance/sections/${sec.id}/daily`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(r.body.days).toHaveLength(3);
    expect(r.body.days[0]).toMatchObject({ date: '2026-11-02', enrolled: 3, present: 1, late: 1, absent: 1, unrecorded: 0, rate: 66.7 });
    expect(r.body.days[1]).toMatchObject({ present: 2, unrecorded: 1, rate: 100 });
    expect(r.body.days[2]).toMatchObject({ upcoming: true, rate: null });
    // Who recorded the marks: two QR self check-ins and one by the admin login.
    expect(r.body.days[0].recordedBy).toEqual([
      expect.objectContaining({ kind: 'SELF', count: 2 }),
      expect.objectContaining({ kind: 'USER', userId: admin.id, email: ADMIN.email, count: 1 }),
    ]);
    const third = r.body.students.find((s: { studentId: string }) => s.studentId === students[2].id);
    expect(third).toMatchObject({ marks: ['ABSENT', null, null], absent: 1, rate: 0 });
    expect(third.marksBy[0]).toMatchObject({ kind: 'USER', email: ADMIN.email, method: 'MANUAL' });
    expect(third.marksBy[1]).toBeNull();
    expect(r.body.totals).toMatchObject({ classDays: 3, daysHeld: 2, averageRate: 80, studentsBelow80: 1 });

    const x = await http.get(`/api/v1/attendance/sections/${sec.id}/daily.xlsx`).set('Authorization', `Bearer ${token}`)
      .buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Daily summary', 'Students x days', 'Recorded by']);
    expect(JSON.stringify(wb.getWorksheet('Recorded by')!.getRow(2).values)).toMatch(/Student \(self check-in\)|admin@nursing\.au\.edu/);
    expect(JSON.stringify(wb.getWorksheet('Students x days')!.getRow(2).values)).toContain('"/"');
  });
});
