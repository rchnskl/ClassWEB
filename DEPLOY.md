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
| **B. Fly.io / Railway / Render** (recommended) | ✅ GA, always-on | Run the container there; put Cloudflare in front for DNS/CDN/TLS/WAF. Still Cloudflare for everything user-facing. More robust today. |

The `apps/api/Dockerfile` works for **both**. This runbook uses **Option B** for the API and
Cloudflare for everything else; a Containers appendix is at the end.

---

## 1. Neon (PostgreSQL)

1. Create a Neon project (region closest to your users, e.g. Singapore `ap-southeast-1`).
2. Copy the **pooled** connection string (has `-pooler` in the host). It looks like:
   `postgresql://USER:PASSWORD@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
3. Keep it as `DATABASE_URL`. Prisma over TCP with `sslmode=require` works directly — no Hyperdrive
   needed for Option B (Hyperdrive only matters if the API runs on Workers).
4. Apply the schema + seed once:
   ```bash
   DATABASE_URL="<neon-url>" npm run migrate:deploy -w @classweb/database
   DATABASE_URL="<neon-url>" npm run db:seed          # creates the admin + RBAC matrix
   ```
   The seed admin is `admin@nursing.au.edu` / `ChangeMe!2026` — **rotate it immediately** after first login.

## 2. Cloudflare R2 (backup storage)

1. Cloudflare dashboard → R2 → create bucket `classweb-backups`.
2. R2 → Manage API Tokens → create an **Access Key** (Object Read & Write) → note the
   Access Key ID + Secret.
3. Your R2 S3 endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
   These map to the API env vars in step 3 (`BACKUP_S3_*`, `BACKUP_STORAGE=s3`).

## 3. API host (Fly.io example) — set env & deploy

Set these environment variables / secrets on the host:

```
NODE_ENV=production
PORT=8080                         # or whatever the platform injects
DATABASE_URL=<neon pooled url>
JWT_ACCESS_SECRET=<32+ random chars>     # openssl rand -hex 32
JWT_REFRESH_SECRET=<32+ random chars>    # different value
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
CORS_ORIGINS=https://app.yourdomain.org  # the Pages URL/custom domain, comma-separated
BACKUP_STORAGE=s3
BACKUP_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=classweb-backups
BACKUP_S3_ACCESS_KEY_ID=<r2 key id>
BACKUP_S3_SECRET_ACCESS_KEY=<r2 secret>
BACKUP_S3_REGION=auto
# optional: SMTP_* (temp-password email), VAPID_* (web push), LINE_CHANNEL_ACCESS_TOKEN
```

Deploy the image (`apps/api/Dockerfile`). Health check path: **`/api/v1/health`**.
The app fails fast at boot if `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are missing or < 16 chars.

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
- `api.yourdomain.org` → the API host (CNAME to Fly/Railway, proxied 🟠 through Cloudflare).
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
