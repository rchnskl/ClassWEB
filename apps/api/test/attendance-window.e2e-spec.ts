import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };
const bangkokDay = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86_400_000));

/**
 * On a session's day check-in is open and waiting without anyone opening
 * it, and it stays open until the lecturer closes it — then it stays closed.
 */
describe('Attendance check-in window', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let token: string;
  let sectionId: string;

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
    sectionId = (await prisma.section.findFirstOrThrow()).id;
  });

  afterAll(async () => { await app?.close(); });

  const session = (day: string, startTime: string) =>
    prisma.classSession.create({ data: { sectionId, sessionDate: new Date(`${day}T00:00:00Z`), startTime, endTime: '23:59' } });
  const state = (id: string) => http.get(`/api/v1/attendance/sessions/${id}`).set('Authorization', `Bearer ${token}`).expect(200);

  it("is open all day on the session's day — even hours before the start — until the lecturer closes it", async () => {
    const cs = await session(bangkokDay(), '23:58');
    const first = await state(cs.id);
    expect(first.body.open).not.toBeNull();
    // Open to the end of the day, not a short window around the start.
    expect(new Date(first.body.open.expiresAt).getTime()).toBe(new Date(`${bangkokDay(1)}T00:00:00+07:00`).getTime());

    await http.post(`/api/v1/attendance/sessions/${cs.id}/close`).set('Authorization', `Bearer ${token}`).expect(201);
    expect((await state(cs.id)).body.open).toBeNull(); // stays closed

    const reopened = await http.post(`/api/v1/attendance/sessions/${cs.id}/open`).set('Authorization', `Bearer ${token}`).expect(201);
    expect(new Date(reopened.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 2.9 * 60 * 60_000);
    expect((await state(cs.id)).body.open).not.toBeNull();
  });

  it('is not open on another day', async () => {
    const cs = await session(bangkokDay(2), '07:00');
    expect((await state(cs.id)).body.open).toBeNull();
  });
});
