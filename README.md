# ClassWeb — Faculty of Nursing Classroom Platform

Enterprise, multi-tenant classroom & attendance platform for the **Faculty of
Nursing, Assumption University**. Built to enterprise standards (SOLID, Clean
Architecture, Repository Pattern, DI) to serve as the faculty's official platform.

**Stack:** PostgreSQL 16 · Prisma · NestJS · Next.js · TypeScript (see
[`docs/architecture/overview.md`](docs/architecture/overview.md)).

## Status

| Phase | Status |
| --- | --- |
| 1 · Multi-tenant data foundation | ✅ Done & verified |
| 2 · Backend core + security | ⬜ Next |
| 3–8 · Domain, timetable/attendance, frontend, analytics, reporting, ops | ⬜ Planned |

Full plan: [`docs/architecture/phase-roadmap.md`](docs/architecture/phase-roadmap.md).

## Quickstart (data layer)

Requires Node ≥ 20 and Docker (for local Postgres).

```bash
npm install                 # install workspaces
npm run db:up               # start PostgreSQL 16 (docker compose)
cp packages/database/.env.example packages/database/.env

npm run db:migrate          # apply migrations
npm run db:seed             # seed Assumption University / Faculty of Nursing
npm run db:studio           # browse the data (Prisma Studio)
```

Seeded admin login (rotate immediately): `admin@nursing.au.edu` / `ChangeMe!2026`.

> No Docker? Point `DATABASE_URL` in `packages/database/.env` at any PostgreSQL 16
> instance and run the same commands.

## Repository layout

```
packages/database/   Prisma schema, migrations, seed — the data source of truth
apps/api/            NestJS backend            (Phase 2)
apps/web/            Next.js frontend          (Phase 4)
docs/architecture/   Architecture & data-model documentation
```

## Data model

**32 tables, 19 enums, 58 foreign keys**, verified against PostgreSQL 16. Multi-tenant
by design — new faculties/campuses/programs are data, not migrations. See
[`docs/architecture/data-model.md`](docs/architecture/data-model.md) for the ERD and
design rationale.
