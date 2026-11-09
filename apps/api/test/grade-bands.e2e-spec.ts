import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };

interface Band { id: string; grade: string; minScore: number; isActive: boolean }

/** A scheme can switch off grades it doesn't award (D/F) — but never all of them, nor leave low scores ungraded. */
describe('Grade bands on/off', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let original: Band[];

  const get = async () => (await http.get('/api/v1/assessment/grade-scheme').set('Authorization', `Bearer ${token}`).expect(200)).body.bands as Band[];
  const patch = (bands: Partial<Band>[]) =>
    http.patch('/api/v1/assessment/grade-scheme').set('Authorization', `Bearer ${token}`).send({ bands });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;
    original = await get();
  });

  afterAll(async () => {
    await patch(original.map(({ id, minScore, isActive }) => ({ id, minScore, isActive })));
    await app?.close();
  });

  it('switches off the lowest grades when the next one up starts at 0', async () => {
    expect(original.every((b) => b.isActive)).toBe(true);
    const [lowest, second] = [...original].sort((a, b) => a.minScore - b.minScore);
    await patch([{ id: lowest.id, minScore: lowest.minScore, isActive: false }, { id: second.id, minScore: 0 }]).expect(200);
    const after = await get();
    expect(after.find((b) => b.id === lowest.id)?.isActive).toBe(false);
    expect(after.find((b) => b.id === second.id)?.minScore).toBe(0);
  });

  it('refuses to leave no grade, or a gap at the bottom', async () => {
    await patch(original.map((b) => ({ id: b.id, minScore: b.minScore, isActive: false }))).expect(400);
    const [lowest, second] = [...original].sort((a, b) => a.minScore - b.minScore);
    await patch([{ id: lowest.id, minScore: lowest.minScore, isActive: true }, { id: second.id, minScore: second.minScore }]).expect(200);
    await patch([{ id: lowest.id, minScore: lowest.minScore, isActive: false }]).expect(400);
  });
});
