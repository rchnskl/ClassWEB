import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const ADMIN = { email: 'admin@nursing.au.edu', password: 'ChangeMe!2026' };

/** supertest parses text by default; binary downloads need collecting by hand. */
function binaryParser(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

/**
 * A report's QR code has to open the real, watermarked document — not just
 * a bare "this number is genuine" confirmation. Proves the whole chain: PDF
 * generation stores the exact file, /verify reports hasFile, and /file
 * serves back real PDF bytes carrying the watermark text.
 */
describe('Report file storage + verify (integration, real Postgres)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = request(app.getHttpServer());
    adminToken = (await http.post('/api/v1/auth/login').send(ADMIN)).body.accessToken;
  });

  afterAll(async () => { await app?.close(); });

  it('stores the generated PDF and serves it back via /reports/file/:reportNumber', async () => {
    const pdfRes = await http.get('/api/v1/reports/attendance.pdf')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer().parse(binaryParser)
      .expect(200);
    const cd = pdfRes.headers['content-disposition'] as string;
    const reportNumber = /filename="([^"]+)\.pdf"/.exec(cd)?.[1];
    expect(reportNumber).toMatch(/^RPT-\d{8}-[0-9A-F]{6}$/);

    const verify = await http.get(`/api/v1/reports/verify/${reportNumber}`).expect(200);
    expect(verify.body.valid).toBe(true);
    expect(verify.body.hasFile).toBe(true);

    const file = await http.get(`/api/v1/reports/file/${reportNumber}`)
      .buffer().parse(binaryParser)
      .expect(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    const bytes = file.body as Buffer;
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Byte-identical to what the export endpoint itself returned.
    expect(Buffer.compare(bytes, pdfRes.body as Buffer)).toBe(0);
  });

  it('404s /reports/file for an unknown report number', async () => {
    await http.get('/api/v1/reports/file/RPT-00000000-000000').expect(404);
  });

  it('/reports/verify reports hasFile:false for a report with no stored content (CSV exports never store one)', async () => {
    const csvRes = await http.get('/api/v1/reports/attendance.csv')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const cd = csvRes.headers['content-disposition'] as string;
    const reportNumber = /filename="([^"]+)\.csv"/.exec(cd)?.[1];

    const verify = await http.get(`/api/v1/reports/verify/${reportNumber}`).expect(200);
    expect(verify.body.hasFile).toBe(false);

    await http.get(`/api/v1/reports/file/${reportNumber}`).expect(404);
  });
});
