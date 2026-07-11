import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { E2E_PG_PORT, E2E_DATABASE_URL } from './e2e-config';

// Boots an ephemeral Postgres, applies every migration, and seeds the RBAC baseline
// (admin user + full permission matrix) so integration tests exercise the real schema.
export default async function globalSetup() {
  const dbPkg = join(__dirname, '..', '..', '..', 'packages', 'database');
  const migrationsDir = join(dbPkg, 'prisma', 'migrations');
  const dataDir = join(__dirname, '.pgdata-e2e');
  rmSync(dataDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'classweb', password: 'classweb', port: E2E_PG_PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  try { await pg.createDatabase('classweb'); } catch { /* exists */ }

  const client = new Client({ host: 'localhost', port: E2E_PG_PORT, user: 'classweb', password: 'classweb', database: 'classweb' });
  await client.connect();
  for (const dir of readdirSync(migrationsDir).filter((d) => /^\d/.test(d)).sort()) {
    await client.query(readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8'));
  }
  await client.end();

  execFileSync('npx', ['tsx', 'prisma/seed.ts'], { cwd: dbPkg, env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, NODE_ENV: 'production' }, stdio: 'ignore' });

  // Shared with global-teardown (same Jest parent process).
  (globalThis as unknown as { __E2E_PG__: EmbeddedPostgres }).__E2E_PG__ = pg;
}
