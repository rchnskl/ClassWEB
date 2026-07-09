# Phase Roadmap — ClassWeb

Delivery is **phased in dependency order**. Each phase is fully working and
verified before the next begins — no placeholders, no dummy APIs. Every subsystem
in the requirements brief is accounted for below.

| Phase | Scope | Brief sections covered | Status |
| --- | --- | --- | --- |
| **1. Data foundation** | Multi-tenant Prisma schema, migrations, seed, ERD docs | Multi-Tenant Architecture, Academic Structure, Course/Room/Student/Lecturer/Section/Enrollment/Attendance **data**, Audit/Settings/Backup tables | ✅ **Done & verified** |
| **2. Backend core + security** | NestJS scaffold, JWT + refresh, RBAC guards, tenant scoping, audit interceptor, Swagger, health checks | Security, API, Audit Log, Monitoring | ✅ **Done & verified** |
| **3. Core domain APIs** | CRUD + services for academic hierarchy, students, lecturers, rooms, sections, enrollment | Course/Room/Student/Lecturer/Section/Enrollment Management | ✅ **Done & verified** |
| **4. Timetable + attendance engine** | Schedule generation, conflict detection, attendance capture (manual + QR), rule engine | Timetable, Attendance Features, Attendance Rule Engine | ✅ **Done & verified** |
| **5. Frontend (admin dashboard)** | Next.js glass-morphism UI, dashboards, search, filters, dark/light, responsive | Dashboard, Design, Search Engine, Filter System, Admin Dashboard | ⬜ |
| **6. Analytics + notifications** | Risk analytics, attendance stats, notifications (email/LINE/push/system) | Dashboard stats, Student Risk Analytics, Notification System | 🔷 Analytics/risk done; notifications next |
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

## Phase 4a — timetable (delivered)

- `timetable` module: add weekly schedule slots with **room / teacher / section
  conflict detection** (time-overlap within the same semester + weekday →
  409 with a specific message), expand schedules into concrete `ClassSession`
  rows across the semester (idempotent, holiday-aware), and read the weekly grid
  + class sessions by date.
- Seed enriched: 2 sections, 4 weekly slots (incl. a session on the current
  weekday), 60 generated class sessions — so the dashboard's "Today's classes"
  and the timetable are populated with real data.
- Frontend: **Timetable** weekly view (time grid, colour-by-subject blocks,
  "today" highlight).

**Verification (live Postgres):** weekly slots listed; room clash → 409
("Room conflict: CL-1101 is already booked 09:00–12:00"); non-conflicting slot →
201; today's sessions = 1; `dashboard.todayClasses` = 1; timetable rendered in
the browser.

**Next (Phase 4b):** attendance capture (manual + QR) + rule engine
(late/auto-absent/lock), writing to `AttendanceRecord` and updating
`enrollment.attendanceRate`.

## Phase 4b — attendance engine (delivered)

- Schema (migration 0004): `AttendanceSession` (open window + QR token),
  `AttendanceCheckIn` (raw scans → PENDING/MATCHED/REJECTED + resolution reason).
- **QR self-service**: lecturer opens a session → QR minted → student scans →
  enters their own student code → matched against the section's enrolment →
  **rule engine** sets PRESENT/LATE/ABSENT (late-after / auto-absent thresholds).
  No match → PENDING → student sees "contact the instructor"; lecturer resolves
  with a reason (make-up from another section / wrong code / late registration /
  other).
- **Manual** marking (present/late/absent) always available. Enrolment
  `attendanceRate` recomputed; every action audited.
- Frontend: lecturer `/attendance` (session picker, live QR, roster + manual
  marking, pending resolution, polling) and public `/checkin/[token]` student page.

**Verified end-to-end in the browser:** lecturer opened attendance and showed the
QR; student check-in with a matching code → ✅ success; non-matching code → ⚠
"contact the instructor" (PENDING on the lecturer side); manual mark + resolve
worked; attendance rate updated.

## Resolved decisions

- **Course → Subject → Section** — confirmed by the faculty: every subject belongs
  to a curriculum Course, so `Subject.courseId` is **required** (see `data-model.md §2`).
