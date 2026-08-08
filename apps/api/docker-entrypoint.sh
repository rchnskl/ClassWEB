#!/bin/sh
# Applies any pending Prisma migrations against DATABASE_URL, then starts the
# API. Without this, the schema in the built Prisma Client can silently drift
# ahead of the live database — every deploy generated a client against the
# new schema.prisma, but nothing ever told the database itself about new
# columns/tables, so a new feature ships and 500s the moment it touches the
# column/table nobody added.
set -e

echo "Clearing any stale migration lock from a previous interrupted deploy..."
node clear-migration-lock.js

echo "Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy --schema=packages/database/prisma/schema.prisma

echo "Starting API..."
exec node apps/api/dist/main.js
