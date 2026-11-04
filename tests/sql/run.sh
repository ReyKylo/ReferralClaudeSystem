#!/usr/bin/env bash
# Builds a throwaway database and runs the SQL tests:
#   Supabase stub -> ERP schema -> referral migrations -> tests/sql/[1-9]*.sql
# ERP schema: the real migrations when ERP_DIR points at a checkout of ReyKylo/ERPClaudeKita, otherwise a small stub.
# Usage: tests/sql/run.sh            (connection via the usual PG* variables; needs psql)
#        ERP_DIR=../ERPClaudeKita tests/sql/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
db="${PGDATABASE_TEST:-ref_test}"
# drop notices, blank lines and bare uuids from the output; with pipefail a psql failure still fails the script
quiet() { grep -v -e NOTICE -e '^\s*$' -e '^ [0-9a-f-]\{36\}$' || true; }
run() { echo "-- $1"; psql -v ON_ERROR_STOP=1 -q -X -d "$db" -f "$1" 2>&1 | quiet; }
psql -v ON_ERROR_STOP=1 -q -X -d postgres -c "drop database if exists $db" -c "create database $db" 2>&1 | quiet
run "$here/00_supabase_stub.sql"
psql -q -X -d "$db" -c "create extension if not exists citext with schema extensions"
if [ -n "${ERP_DIR:-}" ]; then
  # The stub provides vault as plain tables, so the ERP migration's "create extension supabase_vault" line is skipped.
  for f in "$ERP_DIR"/supabase/migrations/*.sql; do
    echo "-- $f"; sed '/create extension if not exists supabase_vault/d' "$f" | psql -v ON_ERROR_STOP=1 -q -X -d "$db" 2>&1 | quiet
  done
else
  run "$here/01_erp_stub.sql"
fi
for f in "$root"/supabase/migrations/*.sql; do run "$f"; done
for f in "$here"/[1-9]*.sql; do
  echo "-- $f"
  psql -v ON_ERROR_STOP=1 -q -X -t -d "$db" -f "$f" 2>&1 | quiet
done
echo "OK: all SQL tests passed"
