# Phase Roadmap — ClassWeb

Delivery is **phased in dependency order**. Each phase is fully working and
verified before the next begins — no placeholders, no dummy APIs. Every subsystem
in the requirements brief is accounted for below.

| Phase | Scope | Brief sections covered | Status |
| --- | --- | --- | --- |
| **1. Data foundation** | Multi-tenant Prisma schema, migrations, seed, ERD docs | Multi-Tenant Architecture, Academic Structure, Course/Room/Student/Lecturer/Section/Enrollment/Attendance **data**, Audit/Settings/Backup tables | ✅ **Done & verified** |
| **2. Backend core + security** | NestJS scaffold, JWT + refresh, RBAC guards, tenant scoping, audit interceptor, Swagger, health checks | Security, API, Audit Log, Monitoring | ⬜ Next |
| **3. Core domain APIs** | CRUD + services for academic hierarchy, students, lecturers, rooms, sections, enrollment | Course/Room/Student/Lecturer/Section/Enrollment Management | ⬜ |
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

## Resolved decisions

- **Course → Subject → Section** — confirmed by the faculty: every subject belongs
  to a curriculum Course, so `Subject.courseId` is **required** (see `data-model.md §2`).
