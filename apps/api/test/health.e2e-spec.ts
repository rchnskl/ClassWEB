import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => { await app?.close(); });

  it('readiness (/health) checks the database', async () => {
    const res = await http.get('/api/v1/health').expect(200);
    expect(res.body.details.database.status).toBe('up');
  });

  it('liveness (/health/live) answers without a token and without touching the database', async () => {
    const prisma = app.get(PrismaService);
    const spy = jest.spyOn(prisma, '$queryRaw');
    const res = await http.get('/api/v1/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
