// classweb-keepalive — Cloudflare Worker (cron trigger: */10 * * * *)
//
// Render's free instance sleeps after 15 minutes without traffic, and the next
// visitor then waits ~50 s for it to boot. This pings the API's liveness
// endpoint every 10 minutes so it stays up — which also lets the 02:00 nightly
// backup job actually run (a sleeping instance never fires it).
//
// It hits /health/live, which does NOT query the database, so Neon's compute
// can still auto-suspend when nobody is using the system. One always-on free
// instance fits inside Render's 750 free instance-hours a month.
//
// Deployed from the Cloudflare dashboard (Workers & Pages → classweb-keepalive);
// this file is the source of record. To stop keeping the API awake, delete the
// Worker or remove its cron trigger.

const TARGET = 'https://classweb-api-sg.onrender.com/api/v1/health/live';

export default {
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(
      fetch(TARGET, { headers: { 'user-agent': 'classweb-keepalive' } }).then((r) => {
        if (!r.ok) console.log(`keepalive: ${TARGET} answered ${r.status}`);
      }),
    );
  },

  // Visiting the Worker's URL shows what it does and pings once (handy to test).
  async fetch() {
    const r = await fetch(TARGET, { headers: { 'user-agent': 'classweb-keepalive' } });
    return new Response(`classweb-keepalive → ${TARGET}: ${r.status}\n`, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
