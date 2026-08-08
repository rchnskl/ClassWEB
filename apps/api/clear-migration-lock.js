// Runs immediately before `prisma migrate deploy` in docker-entrypoint.sh.
//
// Prisma Migrate takes a Postgres session-level advisory lock (a fixed key,
// 72707369, the same for every Prisma project) for the duration of a
// `migrate deploy`/`migrate dev` run. Observed in production: when that run
// is killed abruptly (container restart, deploy timeout, a crash) rather
// than exiting cleanly, the backend holding the lock can be left behind as
// an idle connection that never issues pg_advisory_unlock — and since nothing
// else can ever acquire the lock while it's held, *every subsequent deploy*
// times out after Prisma's fixed 10s wait (P1002), which then reliably
// leaves behind its own stale idle holder, compounding the problem.
//
// This clears any backend already holding that lock before migrate even
// starts. A holder found here is by definition stale: this script always
// runs before `migrate deploy` is invoked, so there is no legitimate
// concurrent migration that could hold it at this point in a single-instance
// deploy.
const { Client } = require('pg');

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.log('clear-migration-lock: no DIRECT_URL/DATABASE_URL set, skipping.');
    return;
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT l.pid FROM pg_locks l WHERE l.locktype = 'advisory' AND l.objid = 72707369 AND l.granted = true`,
    );
    if (rows.length === 0) {
      console.log('clear-migration-lock: no stale migration lock found.');
      return;
    }
    for (const { pid } of rows) {
      console.log(`clear-migration-lock: found stale migration lock held by pid ${pid}, terminating it.`);
      await client.query('SELECT pg_terminate_backend($1::int4)', [pid]);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // Never block the deploy on this best-effort cleanup — if it fails, the
  // migrate step below still runs and will fail on its own with a clear
  // error if a lock is genuinely still stuck.
  console.error('clear-migration-lock: cleanup failed, continuing anyway:', err.message);
});
