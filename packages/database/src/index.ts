/**
 * @classweb/database — the single source of truth for the data model.
 *
 * Exposes a lazily-instantiated PrismaClient singleton (safe across hot-reload
 * in dev) plus the generated types/enums, so the backend service layer and any
 * tooling share one client and one schema.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';
export default prisma;
