// Boots an ephemeral embedded Postgres, applies every migration, seeds the
// RBAC baseline, then starts the NestJS API — for local manual verification
// (axe audits on authed pages, Playwright e2e) without touching the real
// Neon database. Ephemeral: all data resets when this process exits.
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dbPkg = join(root, 'packages', 'database');
const migrationsDir = join(dbPkg, 'prisma', 'migrations');
const dataDir = join(__dirname, '.pgdata-dev');

const PG_PORT = 55450;
const API_PORT = 3001;
const DATABASE_URL = `postgresql://classweb:classweb@localhost:${PG_PORT}/classweb?schema=public`;

const ENV = {
  ...process.env,
  DATABASE_URL,
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  JWT_ACCESS_SECRET: 'dev-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'dev-refresh-secret-0123456789abcdef',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  CORS_ORIGINS: 'http://localhost:3000',
};

async function main() {
  rmSync(dataDir, { recursive: true, force: true });

  console.log('==> Starting embedded Postgres on port', PG_PORT);
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'classweb', password: 'classweb', port: PG_PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  try { await pg.createDatabase('classweb'); } catch { /* already exists */ }

  console.log('==> Applying migrations');
  const client = new Client({ host: 'localhost', port: PG_PORT, user: 'classweb', password: 'classweb', database: 'classweb' });
  await client.connect();
  for (const dir of readdirSync(migrationsDir).filter((d) => /^\d/.test(d)).sort()) {
    await client.query(readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8'));
  }
  await client.end();

  console.log('==> Generating Prisma client');
  execFileSync('npx', ['prisma', 'generate'], { cwd: dbPkg, stdio: 'inherit' });

  console.log('==> Seeding');
  execFileSync('npx', ['tsx', 'prisma/seed.ts'], { cwd: dbPkg, env: { ...ENV, NODE_ENV: 'production' }, stdio: 'inherit' });

  console.log('==> Starting API on port', API_PORT);
  const api = spawn('npx', ['nest', 'start'], { cwd: join(root, 'apps', 'api'), env: ENV, stdio: 'inherit' });

  const shutdown = async () => {
    console.log('\n==> Shutting down');
    api.kill('SIGTERM');
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  api.on('exit', (code) => { pg.stop().finally(() => process.exit(code ?? 0)); });
}

main().catch((err) => { console.error(err); process.exit(1); });
