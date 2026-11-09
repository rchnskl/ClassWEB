import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };

describe('Class sessions on specific dates', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let token: string;
  let sectionId: string;
  let otherSectionId: string;
  let semStart: Date;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

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
    const sections = await prisma.section.findMany({ take: 2, orderBy: { id: 'asc' }, include: { semester: true } });
    sectionId = sections[0].id;
    otherSectionId = sections[1].id;
    semStart = sections[0].semester.startDate;
  });

  afterAll(async () => { await app?.close(); });

  const post = (body: object) => http.post('/api/v1/timetable/sessions').set('Authorization', `Bearer ${token}`).send(body);

  it('creates one session per date, and re-sending is a no-op', async () => {
    // Dates near the end of the section's semester (the duplicate collapses).
    const sem = await prisma.section.findUniqueOrThrow({ where: { id: sectionId }, include: { semester: true } });
    const inside = [iso(plus(sem.semester.endDate, -3)), iso(plus(sem.semester.endDate, -2)), iso(plus(sem.semester.endDate, -3))];
    const first = await post({ sectionId, dates: inside, startTime: '07:00', endTime: '16:00', topic: 'Clinical practice' }).expect(201);
    expect(first.body).toMatchObject({ created: 2, requested: 2 });
    const again = await post({ sectionId, dates: inside, startTime: '07:00', endTime: '16:00' }).expect(201);
    expect(again.body.created).toBe(0);
    const rows = await prisma.classSession.findMany({ where: { sectionId, topic: 'Clinical practice' } });
    expect(rows).toHaveLength(2);
  });

  it('rejects a date outside the semester, a bad time range, and malformed dates', async () => {
    await post({ sectionId, dates: [iso(plus(semStart, -30))], startTime: '07:00', endTime: '16:00' }).expect(400);
    await post({ sectionId, dates: [iso(semStart)], startTime: '16:00', endTime: '07:00' }).expect(400);
    await post({ sectionId, dates: ['10/11/2026'], startTime: '07:00', endTime: '16:00' }).expect(400);
  });

  it('refuses a same-day clash for the lecturer in another section', async () => {
    const lecturer = await prisma.lecturer.findFirstOrThrow();
    const sem = await prisma.section.findUniqueOrThrow({ where: { id: otherSectionId }, include: { semester: true } });
    const day = iso(plus(sem.semester.endDate, -5));
    await post({ sectionId: otherSectionId, dates: [day], startTime: '08:00', endTime: '12:00', lecturerId: lecturer.id }).expect(201);
    const res = await post({ sectionId, dates: [day], startTime: '09:00', endTime: '10:00', lecturerId: lecturer.id });
    if ((await prisma.section.findUniqueOrThrow({ where: { id: sectionId } })).semesterId === sem.semesterId) {
      expect(res.status).toBe(409);
    }
  });
});
