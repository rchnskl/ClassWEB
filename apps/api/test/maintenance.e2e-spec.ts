import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };
const LECTURER = { email: 'p.somchai@nursing.au.edu', password: 'ChangeMe!2026' };

describe('Maintenance (system refresh)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let adminToken: string;
  let lecturerToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    adminToken = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;
    lecturerToken = (await http.post('/api/v1/auth/login').send(LECTURER)).body.accessToken;
  });

  afterAll(async () => { await app?.close(); });

  it('rejects a non-admin (lecturer) from previewing or running maintenance', async () => {
    await http.get('/api/v1/maintenance/preview').set('Authorization', `Bearer ${lecturerToken}`).expect(403);
    await http.post('/api/v1/maintenance/refresh').set('Authorization', `Bearer ${lecturerToken}`).expect(403);
  });

  it('preview counts active refresh tokens without deleting them', async () => {
    const before = await prisma.refreshToken.count();
    expect(before).toBeGreaterThan(0); // the two logins above each created one

    const res = await http.get('/api/v1/maintenance/preview').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.staleRefreshTokens).toBe(before);

    const after = await prisma.refreshToken.count();
    expect(after).toBe(before); // untouched
  });

  it('refresh deletes every refresh token in the tenant, including the caller\'s own', async () => {
    const res = await http.post('/api/v1/maintenance/refresh').set('Authorization', `Bearer ${adminToken}`).expect(201);
    expect(res.body.loggedOutSessions).toBeGreaterThan(0);

    const remaining = await prisma.refreshToken.count();
    expect(remaining).toBe(0);

    // Access token is still a valid JWT for its own TTL — this call still
    // succeeds even though the refresh token backing this exact session is
    // gone, matching the documented ≤15min tail.
    const again = await http.get('/api/v1/maintenance/preview').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(again.body.staleRefreshTokens).toBe(0);
  });

  it('closes an attendance check-in window left open past its expiry', async () => {
    const section = await prisma.section.findFirst({ where: { classSessions: { some: {} } }, select: { id: true } });
    const session = await prisma.classSession.findFirst({ where: { sectionId: section!.id }, select: { id: true } });
    const stale = await prisma.attendanceSession.create({
      data: {
        classSessionId: session!.id,
        token: 'maint-test-token-' + Date.now(),
        expiresAt: new Date(Date.now() - 60_000),
        isOpen: true,
      },
    });

    const freshAdminToken = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;
    const res = await http.post('/api/v1/maintenance/refresh').set('Authorization', `Bearer ${freshAdminToken}`).expect(201);
    expect(res.body.attendanceWindowsClosed).toBeGreaterThanOrEqual(1);

    const reloaded = await prisma.attendanceSession.findUnique({ where: { id: stale.id } });
    expect(reloaded!.isOpen).toBe(false);
    expect(reloaded!.closedAt).not.toBeNull();
  });

  it('marks a backup stuck IN_PROGRESS past the age threshold as FAILED', async () => {
    const university = await prisma.university.findFirst({ where: { code: 'AU' }, select: { id: true } });
    const stuck = await prisma.backup.create({
      data: {
        universityId: university!.id,
        status: 'IN_PROGRESS',
        startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      },
    });
    const fresh = await prisma.backup.create({
      data: { universityId: university!.id, status: 'IN_PROGRESS', startedAt: new Date() },
    });

    const freshAdminToken = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;
    const res = await http.post('/api/v1/maintenance/refresh').set('Authorization', `Bearer ${freshAdminToken}`).expect(201);
    expect(res.body.backupsMarkedFailed).toBeGreaterThanOrEqual(1);

    const stuckReloaded = await prisma.backup.findUnique({ where: { id: stuck.id } });
    expect(stuckReloaded!.status).toBe('FAILED');
    const freshReloaded = await prisma.backup.findUnique({ where: { id: fresh.id } });
    expect(freshReloaded!.status).toBe('IN_PROGRESS'); // untouched — not stuck yet
  });

  it('prunes audit logs older than the retention window, keeps recent ones', async () => {
    const university = await prisma.university.findFirst({ where: { code: 'AU' }, select: { id: true } });
    const oldLog = await prisma.auditLog.create({
      data: { universityId: university!.id, action: 'VIEW', createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) },
    });
    const recentLog = await prisma.auditLog.create({
      data: { universityId: university!.id, action: 'VIEW', createdAt: new Date() },
    });

    const freshAdminToken = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;
    const res = await http.post('/api/v1/maintenance/refresh').set('Authorization', `Bearer ${freshAdminToken}`).expect(201);
    expect(res.body.auditLogsPruned).toBeGreaterThanOrEqual(1);

    expect(await prisma.auditLog.findUnique({ where: { id: oldLog.id } })).toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: recentLog.id } })).not.toBeNull();
  });
});
