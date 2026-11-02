#!/usr/bin/env bash
# Runs the Z-SHIRTS rules test against a fresh local Postgres database.
# Usage: PGHOST=... PGPORT=... bash supabase/tests/run_tests.sh
set -eo pipefail
cd "$(dirname "$0")/.."
DB=zshirts_test
psql -U postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null
psql -U postgres -d postgres -qc "do \$\$ begin create role anon nologin; exception when duplicate_object then null; end \$\$" \
  -c "do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$" >/dev/null
sed '/create role/d' tests/supabase_stub.sql | psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/001_phase1_partner_ledger.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/003_phase2_commerce.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/005_phase3_growth.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/007_phase4_people_targets_cash.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/008_phase5_moments_demand.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f tests/test_members.sql >/dev/null
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/rules_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/commerce_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/growth_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/people_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
