import type EmbeddedPostgres from 'embedded-postgres';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

export default async function globalTeardown() {
  const pg = (globalThis as unknown as { __E2E_PG__?: EmbeddedPostgres }).__E2E_PG__;
  if (pg) { try { await pg.stop(); } catch { /* already down */ } }
  rmSync(join(__dirname, '.pgdata-e2e'), { recursive: true, force: true });
}
