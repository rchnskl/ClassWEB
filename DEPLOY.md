# ClassWeb — Deployment Runbook (Cloudflare + Neon)

Target stack:

- **Frontend (Next.js)** → Cloudflare Pages
- **API (NestJS)** → a container host (see the API-hosting decision below)
- **Database (PostgreSQL)** → Neon
- **Backups (object storage)** → Cloudflare R2

> This repo is deploy-ready: the API reads all config from environment variables,
> validates JWT secrets at startup, and stores backups via a pluggable adapter
> (`BACKUP_STORAGE=s3` → R2). What remains is provisioning accounts and wiring
> secrets — steps that require **your** Cloudflare/Neon logins and cannot be
> automated from here.

---

## 0. Decision: where does the NestJS API run?

NestJS is a full Node/Express server — it **cannot** run on Cloudflare Workers (no full Node
runtime, no long-lived process). Two options, both still "Cloudflare + Neon":

| Option | Reliability | Notes |
|---|---|---|
| **A. Cloudflare Containers** | ⚠️ Beta (no SLA, cold start 2–3s) | Pure-Cloudflare. Uses a Worker + container-enabled Durable Object wrapper. Fine for a pilot, riskier for a system a faculty depends on daily. |
| **B. Render** (recommended, free tier) | ✅ GA | Run the container there via the included `render.yaml` blueprint; put Cloudflare in front for DNS/CDN/TLS/WAF. Free tier sleeps after ~15min idle (cold start ~1min on first hit) — fine for a pilot, upgrade to a paid instance (~$7/mo, always-on) once used faculty-wide. |

The `apps/api/Dockerfile` works for **both**. This runbook uses **Option B** for the API and
Cloudflare for everything else; a Containers appendix is at the end.

---

## 1. Neon (PostgreSQL)

1. Create a Neon project (region closest to your users, e.g. Singapore `ap-southeast-1`).
2. Copy **both** connection strings from the Neon dashboard:
   - **Pooled** (has `-pooler` in the host) → `DATABASE_URL`, what the API uses at runtime:
     `postgresql://USER:PASSWORD@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
   - **Direct** (no `-pooler`) → `DIRECT_URL`, what `prisma migrate` uses:
     `postgresql://USER:PASSWORD@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

   Both are required. Migrations take a Postgres session-level advisory lock for the
   duration of the run; over the pooled endpoint the lock and its release can land on
   different backends, and the *next* deploy's migration then times out waiting on a
   lock nothing is actually holding (`P1002`, `Timed out trying to acquire a postgres
   advisory lock`). `DIRECT_URL` sidesteps the pooler for that one operation only —
   see the `datasource` comment in `packages/database/prisma/schema.prisma`.
3. Prisma over TCP with `sslmode=require` works directly — no Hyperdrive needed for
   Option B (Hyperdrive only matters if the API runs on Workers).
4. Apply the schema + seed once:
   ```bash
   DATABASE_URL="<neon-pooled-url>" DIRECT_URL="<neon-direct-url>" npm run migrate:deploy -w @classweb/database
   DATABASE_URL="<neon-pooled-url>" npm run db:seed          # creates the admin + RBAC matrix
   ```
   The seed admin is `admin@nursing.au.edu` / `ChangeMe!2026` — **rotate it immediately** after first login.

## 2. Cloudflare R2 (backup storage)

1. Cloudflare dashboard → R2 → create bucket `classweb-backups`.
2. R2 → Manage API Tokens → create an **Access Key** (Object Read & Write) → note the
   Access Key ID + Secret.
3. Your R2 S3 endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
   These map to the API env vars in step 3 (`BACKUP_S3_*`, `BACKUP_STORAGE=s3`).

## 3. API host (Render, via Blueprint) — one connect, not field-by-field

The repo includes `render.yaml` — a Blueprint that pre-configures the whole service (Docker
build, health check, JWT secrets auto-generated) so you don't set anything up by hand.

1. [render.com](https://render.com) → sign in with GitHub.
2. Dashboard → **New +** → **Blueprint** → connect this repo (`rchnskl/ClassWEB`).
3. Render reads `render.yaml` and shows the `classweb-api` service. It asks for the values
   marked `sync: false`:
   - `DATABASE_URL` → your Neon **pooled** connection string (`...-pooler...neon.tech/...?sslmode=require`)
   - `DIRECT_URL` → your Neon **direct** connection string (same host, no `-pooler`) — see step 1
   - `CORS_ORIGINS` → leave blank for now; come back and set it once Cloudflare Pages (step 4)
     gives you its URL, then redeploy.
4. **Apply** → Render builds `apps/api/Dockerfile` and deploys. `JWT_ACCESS_SECRET` /
   `JWT_REFRESH_SECRET` are auto-generated (strong random values) — you never see or set them.
5. Once live, note the service URL (`https://classweb-api-xxxx.onrender.com`) — that's your API base.

Health check path: **`/api/v1/health`**. The app fails fast at boot if the JWT secrets are
missing or under 16 chars (Render's `generateValue: true` always produces long ones, so this
should never trigger).

Backups (`BACKUP_STORAGE=s3` + `BACKUP_S3_*`, see step 2) aren't in the blueprint yet — add them
as extra environment variables on the service once the R2 bucket exists, if you want off-host
backups from day one. Local-disk backups (the default) work fine for a pilot but don't survive
a Render redeploy, since the container filesystem is ephemeral there.

## 4. Cloudflare Pages (frontend)

The frontend talks to the API purely over HTTP, so it needs one build-time variable:
`NEXT_PUBLIC_API_URL=https://api.yourdomain.org/api/v1`.

1. Pages → Create → Connect to Git → pick this repo.
2. Build settings:
   - Root directory: `apps/web`
   - Build command: `npm ci && npm run build`
   - Since the app uses the Next.js App Router with one dynamic route (`/verify/[reportNumber]`),
     use the Cloudflare Next.js adapter: add `@cloudflare/next-on-pages` and set the build
     command to `npx @cloudflare/next-on-pages`, output dir `.vercel/output/static`.
     (Alternatively run the frontend as a Node app on the same host as the API.)
3. Environment variable: `NEXT_PUBLIC_API_URL` = your API URL.
4. Add your custom domain to the Pages project; Cloudflare issues TLS automatically.

## 5. DNS + custom domains (Cloudflare)

- `app.yourdomain.org` → the Pages project.
- `api.yourdomain.org` → the API host (CNAME to the Render URL, proxied 🟠 through Cloudflare).
- After DNS is live, set `CORS_ORIGINS` (API) to the exact `https://app.yourdomain.org`
  and `NEXT_PUBLIC_API_URL` (Pages) to `https://api.yourdomain.org/api/v1`, then redeploy both.

## 6. Post-deploy checklist

- [ ] Log in as `admin@nursing.au.edu`, immediately change the password.
- [ ] Create a manual backup (Settings → Backup) and confirm the object appears in the R2 bucket.
- [ ] Confirm the session lock works (idle) and the QR report-verify page (`/verify/...`) loads.
- [ ] Set `JWT_*` secrets to strong random values (not the dev ones).
- [ ] Turn on Cloudflare WAF managed rules + rate limiting on `api.yourdomain.org`.
- [ ] Schedule Neon's automated backups (independent of the app-level JSON backups).

---

## Appendix — Option A: API on Cloudflare Containers (beta)

If you insist on pure-Cloudflare hosting for the API:

1. `npm i -D wrangler @cloudflare/containers`
2. Add a thin Worker that wraps the container as a Durable Object (`defaultPort = 8080`,
   forward requests via `container.fetch(request)`), and a `wrangler.toml` referencing
   `apps/api/Dockerfile` as the container image.
3. Bind R2 directly (`[[r2_buckets]]`) instead of S3 keys, or keep `BACKUP_STORAGE=s3` with an
   R2 access key — both work.
4. `npx wrangler deploy`.

Caveats: beta (API may change, no SLA), 2–3s cold starts, no autoscaling (manual `getRandom()`
load-balancing), ephemeral disk (so `BACKUP_STORAGE=s3` is mandatory — never `local`).
