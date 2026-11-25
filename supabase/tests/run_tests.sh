#!/usr/bin/env bash
# Runs the SINDIICAT rules test against a fresh local Postgres database.
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
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/009_cash_handover_only.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/010_phase6_finance_store_dtf.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/011_phase7_settings_finance_targets_discount.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/012_damage_claims_ot_leave_delete.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/013_purchase_orders.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/014_shop_experience.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/015_regular_fit.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/016_full_listing.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/017_rename_sindiicat.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/018_vendor_visits.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/019_auto_labels.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/020_small_changes_no_vote.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/021_sc_prefix.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f migrations/022_partner_only_settings.sql >/dev/null
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f tests/test_members.sql >/dev/null
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/rules_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/commerce_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/growth_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/people_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/finance_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/damage_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/po_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/shop_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/fit_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/listing_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/visits_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/labels_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/novote_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/prefix_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -f tests/privacy_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
