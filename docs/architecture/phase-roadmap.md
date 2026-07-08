# Phase Roadmap — ClassWeb

Delivery is **phased in dependency order**. Each phase is fully working and
verified before the next begins — no placeholders, no dummy APIs. Every subsystem
in the requirements brief is accounted for below.

| Phase | Scope | Brief sections covered | Status |
| --- | --- | --- | --- |
| **1. Data foundation** | Multi-tenant Prisma schema, migrations, seed, ERD docs | Multi-Tenant Architecture, Academic Structure, Course/Room/Student/Lecturer/Section/Enrollment/Attendance **data**, Audit/Settings/Backup tables | ✅ **Done & verified** |
| **2. Backend core + security** | NestJS scaffold, JWT + refresh, RBAC guards, tenant scoping, audit interceptor, Swagger, health checks | Security, API, Audit Log, Monitoring | ✅ **Done & verified** |
| **3. Core domain APIs** | CRUD + services for academic hierarchy, students, lecturers, rooms, sections, enrollment | Course/Room/Student/Lecturer/Section/Enrollment Management | ✅ **Done & verified** |
| **4. Timetable + attendance engine** | Schedule generation, conflict detection, attendance capture (manual + QR), rule engine | Timetable, Attendance Features, Attendance Rule Engine | ⬜ |
| **5. Frontend (admin dashboard)** | Next.js glass-morphism UI, dashboards, search, filters, dark/light, responsive | Dashboard, Design, Search Engine, Filter System, Admin Dashboard | ⬜ |
| **6. Analytics + notifications** | Risk analytics, attendance stats, notifications (email/LINE/push/system) | Dashboard stats, Student Risk Analytics, Notification System | ⬜ |
| **7. Reporting + PDF** | Report center, PDF/Excel/CSV export, digital signature, QR verification | Report Center, PDF Design | ⬜ |
| **8. Ops** | Backup/restore, system settings UI, CI/CD (GitHub Actions), monitoring/error tracking, tests (unit/integration/e2e) | Backup, System Settings, CI/CD, Monitoring, Testing | ⬜ |
| **Future** | Gradebook, quiz/exam, OSCE, clinical logbook, portfolio, AI features, … — attach via new tables to existing anchors | Future Modules, AI Features | 🔷 Enabled by Phase-1 design, built on demand |

## Phase 1 — what was delivered

- `packages/database/prisma/schema.prisma` — 32 tables, 19 enums, 58 FKs.
- `packages/database/prisma/migrations/0001_init/migration.sql` — executable, **verified against PostgreSQL 16**.
- `packages/database/prisma/seed.ts` — idempotent seed for Assumption University /
  Faculty of Nursing incl. the full RBAC permission matrix (110 permissions).
- `docker-compose.yml` — one-command local Postgres.
- Architecture docs (`overview.md`, `data-model.md`, this roadmap).

**Verification performed:** migration applied to a real Postgres server; FK and
composite-unique constraints proven to enforce; seed run twice to prove idempotency;
ADMIN role confirmed to hold all 110 permissions.

## Phase 2 — what was delivered

- `apps/api` — NestJS 11 (TypeScript) backend, feature-module structure.
- **Auth**: `POST /api/v1/auth/login | refresh | logout` — JWT access + refresh
  with **rotation** (refresh tokens stored as SHA-256 hashes, single-use), bcrypt
  password verification (cost 12), user-enumeration-resistant login.
- **RBAC**: global `JwtAuthGuard` + `PermissionsGuard`, `@Public()` /
  `@Permissions()` / `@CurrentUser()` decorators, permission set resolved from the
  Phase-1 matrix.
- **Multi-tenant isolation**: every query scoped by the caller's `universityId`
  (demonstrated in `GET /api/v1/users`).
- **Audit**: global interceptor logs every mutating request; auth events logged
  explicitly — all to the Phase-1 `AuditLog`.
- **Security**: Helmet, CORS allow-list, rate limiting (Throttler), strict
  `ValidationPipe`, fail-fast env validation, uniform error filter.
- **Ops**: `GET /api/v1/health` (Terminus + DB ping), Swagger at `/api/docs`.

**Verification performed (end-to-end against a real Postgres):** 10/10 checks —
boot+health, 401 without token, 401 on bad password, admin login issues tokens,
`/users/me`, RBAC allow (admin) vs deny (lecturer → 403), refresh rotation +
single-use enforcement (reused token → 401), and audit rows written.

## Phase 3 — what was delivered

- Feature modules under `apps/api/src`: **students** (full CRUD, with a dedicated
  Repository + Service split as the reference pattern), **sections**, **subjects**,
  **lecturers**, **rooms**, **enrollments**, and **academic** (programs / years /
  semesters read for selectors).
- Every endpoint is tenant-scoped, RBAC-gated (`<resource>:<action>`), validated,
  paginated and searchable. Cross-aggregate integrity enforced (e.g. a student's
  program, a section's subject/semester/lecturer/room must belong to the tenant).
- **Enrollment** engine: capacity check + duplicate guard + atomic
  `currentEnrollment` counter maintenance in a transaction; drop restores capacity.
- Frontend: **Students** page (live list, debounced search, pagination, inline
  create form populated from `/programs`) and a navigable sidebar.

**Verification (end-to-end against live Postgres):** listed students/sections/
subjects/lecturers/rooms/programs with real seeded data; created a student via API
and via the UI; enrolled a student (counter 2→3); duplicate enroll → 409; RBAC
lecturer create-student → 403 while read → 200; Students page rendered with real
data in the browser.

## Resolved decisions

- **Course → Subject → Section** — confirmed by the faculty: every subject belongs
  to a curriculum Course, so `Subject.courseId` is **required** (see `data-model.md §2`).
