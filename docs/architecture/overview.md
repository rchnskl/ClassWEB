# Architecture Overview — ClassWeb

Enterprise classroom & attendance platform. Current tenant: **Faculty of Nursing,
Assumption University**. Built multi-tenant so additional faculties/universities
are configuration, not re-engineering.

## Stack

| Layer | Technology | Rationale |
| --- | --- | --- |
| Database | **PostgreSQL 16** | Multi-tenancy, RLS, JSON, longevity |
| ORM / data layer | **Prisma 6** | Type-safe repository layer, migrations, one source of truth |
| Backend | **NestJS (TypeScript)** | DI, modules, guards/interceptors, first-class Swagger — the native home of Clean Architecture / SOLID |
| Frontend | **Next.js + React + Tailwind** | Glass-morphism admin UI, dark/light, responsive |
| Auth | **JWT + refresh tokens**, RBAC | Per the security requirements |

## Monorepo layout

```
CLASSWEB/
├── package.json              # npm workspaces root
├── docker-compose.yml        # local PostgreSQL 16
├── docs/architecture/        # this documentation
├── packages/
│   └── database/             # ← Phase 1: Prisma schema, migrations, seed (source of truth)
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/0001_init/migration.sql
│       │   └── seed.ts
│       └── src/index.ts      # shared PrismaClient singleton
├── apps/
│   ├── api/                  # ← Phase 2: NestJS backend (planned)
│   └── web/                  # ← Phase 4: Next.js frontend (planned)
```

The `apps/` directories are placeholders in this document only — no empty stub
code has been committed. Each is created when its phase starts.

## Clean Architecture layering (applies from Phase 2 onward)

```
HTTP (Controller) → Service (use-case) → Repository (Prisma) → Database
                         ↑ DTOs / domain models ↑
Cross-cutting: Guards (authN/authZ), Interceptors (audit, tenant scope), Pipes (validation)
```

- **Repository Pattern** — Prisma access is confined to repository classes; services
  depend on repository interfaces (Dependency Inversion).
- **Service Layer** — business rules (attendance engine, conflict detection, risk
  analytics) live in services, not controllers.
- **Feature-based modules** — each subsystem is a NestJS module (`attendance`,
  `timetable`, `enrollment`, …) with its own controller/service/repository/DTOs.

## Multi-tenancy enforcement (Phase 2)

1. Auth resolves the caller's `universityId` from the JWT.
2. A **TenantInterceptor** injects the tenant scope into a request-scoped context.
3. Repositories apply `universityId` automatically; a PostgreSQL **RLS policy**
   is the defence-in-depth backstop.

## Security posture (Phase 6)

JWT + refresh (hashed at rest), RBAC permission matrix, bcrypt password hashing
(cost 12), Helmet secure headers, rate limiting, CSRF, input validation
(class-validator), parameterised queries via Prisma (SQL-injection safe by
construction), and the immutable `AuditLog`.

See [`phase-roadmap.md`](./phase-roadmap.md) for how every requirement in the
brief maps to a delivery phase.
