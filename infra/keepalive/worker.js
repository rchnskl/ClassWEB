// classweb-keepalive — Cloudflare Worker
// Cron trigger: */10 0-11 * * 1-6  (every 10 min, Mon–Sat 07:00–18:59 Bangkok)
//
// Render's free instance sleeps after 15 minutes without traffic, and the next
// visitor then waits ~50 s for it to boot. During teaching hours this pings the
// API's liveness endpoint every 10 minutes so it stays up; outside them it
// lets the instance sleep.
//
// Quota: /health/live does NOT query the database, so these pings never wake
// Neon — its compute still auto-suspends whenever nobody is using the system,
// and only real use spends Neon compute-hours. Limiting the pings to teaching
// hours also keeps Render's free instance-hours well under the monthly cap.
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
