#!/usr/bin/env bash
# fresh-start.sh show  -> lists what is in the database right now (changes nothing)
# The wipe part is added only after the partners confirm exactly what goes.
set -euo pipefail
STACK=/opt/sindiicat/stack
getenv() { awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$STACK/.env"; }
PW=$(getenv POSTGRES_PASSWORD)
q() { docker exec -e PGPASSWORD="$PW" supabase-db psql -h 127.0.0.1 -U supabase_admin -d postgres -q "$@" </dev/null; }

case "${1:-show}" in
show)
  echo; echo "=== HOW MANY ROWS IN EACH LIST ==="
  q -Atc "select string_agg(format('%-24s %s', t, n), E'\n' order by t) from (
            select c.relname t, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', c.relname), false, true, '')))[1]::text::int n
            from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'r') x where n > 0"
  echo; echo "=== PRODUCTS ===";       q -Atc "select id || '  ' || name || case when deleted_at is not null then '  (deleted)' when not active then '  (hidden)' else '' end from products order by id"
  echo; echo "=== CATEGORIES ===";     q -Atc "select name from categories order by id"
  echo; echo "=== VENDORS ===";        q -Atc "select name || coalesce('  ' || city, '') from vendors order by id"
  echo; echo "=== VENDOR VISITS ===";  q -Atc "select name || '  ' || city || '  ' || visited_on from vendor_visits order by visited_on"
  echo; echo "=== COUPONS ===";        q -Atc "select code from coupons order by id"
  echo; echo "=== INFLUENCERS ===";    q -Atc "select name from influencers order by id"
  echo; echo "=== ORDERS ===";         q -Atc "select count(*) || ' orders, first ' || coalesce(min(created_at)::date::text, '-') || ', last ' || coalesce(max(created_at)::date::text, '-') from orders"
  echo; echo "=== MONEY ENTRIES ===";  q -Atc "select kind || ': ' || count(*) || ' entries, ₹' || sum(amount) from ledger group by kind order by kind"
  echo; echo "=== TEAM LOGINS (kept) ==="; q -Atc "select name || '  ' || role from members order by role, name"
  echo; echo "=== SHOP CUSTOMER LOGINS ==="; q -Atc "select count(*) from auth.users u where not exists (select 1 from public.members m where lower(m.email) = lower(u.email))"
  echo; echo "Nothing was changed."
  ;;
*) echo "Only 'show' is available for now."; exit 1 ;;
esac
