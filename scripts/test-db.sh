#!/usr/bin/env bash
# Aplica núcleo + módulos instalados en un Postgres local y corre las pruebas de flujo.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-fleet_ops_test}
node scripts/modules.mjs sync >/dev/null
dropdb --if-exists "$DB" && createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null; done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/01_flows.sql
