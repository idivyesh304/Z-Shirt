#!/usr/bin/env bash
# Runs the Z-SHIRTS rules test against a fresh local Postgres database.
# Usage: PGHOST=... PGPORT=... bash supabase/tests/run_tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=zshirts_test
psql -U postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null
psql -U postgres -d postgres -qc "do \$\$ begin create role anon nologin; exception when duplicate_object then null; end \$\$" \
  -c "do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$" >/dev/null
sed '/create role/d' tests/supabase_stub.sql | psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/001_phase1_partner_ledger.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f seed/members.sql >/dev/null
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/rules_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
