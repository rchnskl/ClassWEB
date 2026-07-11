import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { E2E_DATABASE_URL, E2E_ENV } from './e2e-config';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };
const LECTURER = { email: 'p.somchai@nursing.au.edu', password: 'ChangeMe!2026' };

describe('Auth & session (integration, real Postgres)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Mirror main.ts so routes + validation behave identically to production.
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => { await app?.close(); });

  const login = (body: { email: string; password: string }) => http.post('/api/v1/auth/login').send(body);

  describe('login', () => {
    it('accepts correct credentials and returns a token pair', async () => {
      const res = await login(ADMIN).expect(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user.roleCodes).toContain('ADMIN');
    });

    it('rejects a wrong password with 401', async () => {
      await login({ email: ADMIN.email, password: 'wrong-password' }).expect(401);
    });

    it('rejects an unknown user with 401 (no enumeration)', async () => {
      await login({ email: 'ghost@nursing.au.edu', password: 'whatever' }).expect(401);
    });
  });

  describe('verify-password (idle-unlock)', () => {
    let token: string;
    beforeAll(async () => { token = (await login(ADMIN)).body.accessToken; });

    it('204 for the correct current password', async () => {
      await http.post('/api/v1/auth/verify-password').set('Authorization', `Bearer ${token}`).send({ password: ADMIN.password }).expect(204);
    });
    it('401 for a wrong password', async () => {
      await http.post('/api/v1/auth/verify-password').set('Authorization', `Bearer ${token}`).send({ password: 'wrong' }).expect(401);
    });
    it('401 without a token', async () => {
      await http.post('/api/v1/auth/verify-password').send({ password: ADMIN.password }).expect(401);
    });
  });

  describe('refresh rotation', () => {
    it('rotates tokens and revokes the presented one (no reuse)', async () => {
      const { refreshToken } = (await login(ADMIN)).body;
      const rotated = await http.post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
      expect(rotated.body.refreshToken).toBeDefined();
      expect(rotated.body.refreshToken).not.toEqual(refreshToken);
      // Re-using the now-revoked token must fail.
      await http.post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    });
  });

  describe('absolute 3h session cap (server-enforced)', () => {
    it('refuses to refresh a session whose anchor is older than 3h', async () => {
      const { sub } = jwt.decode((await login(ADMIN)).body.refreshToken) as { sub: string };
      // Forge a valid-signature refresh token anchored 4h in the past and register its hash.
      const sat = Math.floor(Date.now() / 1000) - 4 * 3600;
      const forged = jwt.sign({ sub, jti: randomUUID(), sat }, E2E_ENV.JWT_REFRESH_SECRET, { expiresIn: '7d' });
      const client = new Client({ connectionString: E2E_DATABASE_URL });
      await client.connect();
      await client.query(
        'INSERT INTO refresh_tokens (id,"userId","tokenHash","expiresAt","createdAt") VALUES ($1,$2,$3,$4,now())',
        [randomUUID().replace(/-/g, '').slice(0, 25), sub, createHash('sha256').update(forged).digest('hex'), new Date(Date.now() + 7 * 864e5)],
      );
      await client.end();
      const res = await http.post('/api/v1/auth/refresh').send({ refreshToken: forged }).expect(401);
      expect(res.body.message).toMatch(/expired/i);
    });
  });

  describe('RBAC enforcement', () => {
    let facultyId: string;
    let adminToken: string;
    let lecturerToken: string;
    beforeAll(async () => {
      adminToken = (await login(ADMIN)).body.accessToken;
      lecturerToken = (await login(LECTURER)).body.accessToken;
      const programs = await http.get('/api/v1/programs').set('Authorization', `Bearer ${adminToken}`).expect(200);
      facultyId = programs.body[0].faculty.id;
    });

    it('blocks an unauthenticated request to a protected route (401)', async () => {
      await http.get('/api/v1/programs').expect(401);
    });

    it('forbids a lecturer from creating a program (403)', async () => {
      await http.post('/api/v1/programs').set('Authorization', `Bearer ${lecturerToken}`)
        .send({ facultyId, code: 'X-LEC', nameEn: 'Should be blocked' }).expect(403);
    });

    it('allows an admin to create a program (201)', async () => {
      const res = await http.post('/api/v1/programs').set('Authorization', `Bearer ${adminToken}`)
        .send({ facultyId, code: 'E2E-PROG', nameEn: 'E2E Program' }).expect(201);
      expect(res.body.code).toBe('E2E-PROG');
    });
  });
});
