#!/usr/bin/env bash
# One-shot: point ClassWeb at your Neon database, create all tables, seed admin + RBAC.
# The connection string never leaves your machine — it is read hidden and used locally.
#
# Run:  bash db-setup.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "=================================================="
echo "  ClassWeb → Neon database setup"
echo "=================================================="
echo
echo "Paste your Neon POOLED connection string, then press Enter."
echo "(It looks like: postgresql://USER:PASS@ep-xxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require)"
echo "Input is hidden for safety."
echo
printf "DATABASE_URL: "
read -rs DB_URL
echo
echo

if [ -z "${DB_URL}" ]; then
  echo "❌ Nothing entered. Run the script again and paste the string."
  exit 1
fi

case "$DB_URL" in
  postgresql://*|postgres://*) : ;;
  *) echo "❌ That doesn't look like a Postgres URL (must start with postgresql://). Try again."; exit 1 ;;
esac

case "$DB_URL" in
  *-pooler.*) : ;;
  *) echo "⚠️  Warning: this doesn't contain '-pooler' — you may have copied the DIRECT string."
     echo "   It will still work for setup, but use the POOLED one in Railway later."
     echo ;;
esac

export DATABASE_URL="$DB_URL"

echo "==> [1/3] Generating Prisma client..."
npm run generate -w @classweb/database

echo
echo "==> [2/3] Creating all tables in Neon (migrate deploy)..."
npm run migrate:deploy -w @classweb/database

echo
echo "==> [3/3] Seeding admin account + RBAC permission matrix..."
npm run seed -w @classweb/database

echo
echo "=================================================="
echo "✅ Neon database is ready."
echo "   Seed admin login:  admin@nursing.au.edu"
echo "   Seed password:     ChangeMe!2026   (change it after first login)"
echo "=================================================="
