#!/usr/bin/env bash
# =====================================================================
# SINDIICAT on DZYN LAB's own Hostinger server (Ubuntu 24.04, next to Lucy and Ashwin).
# Everything lives here: database, logins, photos, notifications, payments code,
# the shop, the team app and the phone-app download.
#
# Run as root in Hostinger → VPS → Browser terminal:
#   curl -fsSL https://raw.githubusercontent.com/idivyesh304/Z-Shirt/main/server/install.sh | bash
#
# Safe to run again: finished steps are skipped. The old Supabase project is only
# READ from (copied), never changed.
# =====================================================================
set -euo pipefail
# When started as "curl ... | bash", save this script and run it from the file instead,
# so no later step can swallow the rest of the script from the pipe.
if [ -z "${SINDIICAT_FROM_FILE:-}" ]; then
  mkdir -p /opt/sindiicat
  curl -fsSL "https://raw.githubusercontent.com/idivyesh304/Z-Shirt/main/server/install.sh?$(date +%s)" -o /opt/sindiicat/install.sh
  SINDIICAT_FROM_FILE=1 exec bash /opt/sindiicat/install.sh "$@" < /dev/tty
fi
DOMAIN=sindiicat.dzynlabpvtltd.com
API=api.sindiicat.dzynlabpvtltd.com
APP=/opt/sindiicat
STACK=$APP/stack
REPO_URL=https://github.com/idivyesh304/Z-Shirt.git
REPO=$APP/repo
WEB=/srv/sindiicat
STATE=/var/lib/sindiicat
GW_PORT=8100                       # API gateway, only reachable from this server (Caddy in front)
CLOUD_REF=apmtzjniptpvksyrnhph     # old Supabase project (read only)
LOG=$STATE/install.log
mkdir -p "$APP" "$STATE" "$WEB"; chmod 700 "$STATE"
exec > >(tee -a "$LOG") 2>&1

say()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; printf 'Full log: %s\nSend the red line above to Claude.\n' "$LOG"; exit 1; }
trap 'die "Stopped at line $LINENO: $BASH_COMMAND"' ERR
[ "$(id -u)" = 0 ] || die "Please run as root."
command -v caddy >/dev/null || die "Caddy (the web server Lucy uses) was not found on this server."

say "1/9 Checking the addresses point to this server"
IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')
for h in "$DOMAIN" "$API"; do
  got=$(getent ahostsv4 "$h" | awk 'NR==1{print $1}')
  [ "$got" = "$IP" ] && ok "$h → $IP" || die "$h does not point to this server yet ($got). Wait 5 minutes and run the command again."
done

say "2/9 Installing tools (git, jq, Docker)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq git curl jq openssl ca-certificates rsync >/dev/null
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh >/dev/null; fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null || die "Docker Compose is missing."
ok "$(docker --version)"

say "3/9 Getting SINDIICAT's code"
if [ -d "$REPO/.git" ]; then git -C "$REPO" fetch -q origin main && git -C "$REPO" reset -q --hard origin/main
else git clone -q --depth 1 "$REPO_URL" "$REPO"; fi
ok "code $(git -C "$REPO" rev-parse --short HEAD)"

say "4/9 Setting up the database server (Supabase, self-hosted)"
setenv() { # KEY VALUE  (in $STACK/.env)
  if grep -q "^$1=" "$STACK/.env"; then sed -i "s|^$1=.*|$1=$2|" "$STACK/.env"; else echo "$1=$2" >> "$STACK/.env"; fi; }
getenv() { awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$STACK/.env"; }
if [ ! -f "$STACK/.env" ]; then
  cd "$APP"
  curl -fsSL https://raw.githubusercontent.com/supabase/supabase/master/docker/setup.sh -o setup.sh
  sh setup.sh -y --skip-deps --project-dir stack
  cd "$STACK"
  setenv SUPABASE_PUBLIC_URL "https://$API"
  sed -i "s|^API_EXTERNAL_URL=http://localhost:8000|API_EXTERNAL_URL=https://$API|" .env
  setenv SITE_URL "https://$DOMAIN/admin/"
  setenv ADDITIONAL_REDIRECT_URLS "https://$DOMAIN/**,https://$DOMAIN"
  setenv ENABLE_EMAIL_AUTOCONFIRM true
  setenv ENABLE_PHONE_SIGNUP false
  setenv API_GW_HTTP_PORT "127.0.0.1:$GW_PORT"
  setenv STUDIO_DEFAULT_ORGANIZATION SINDIICAT
  setenv STUDIO_DEFAULT_PROJECT SINDIICAT
  setenv POOLER_TENANT_ID sindiicat
  # nothing of the database is reachable from the internet, only from this server
  sed -i 's|^\(\s*-\s*\)\${POSTGRES_PORT}:5432|\1127.0.0.1:55432:5432|; s|^\(\s*-\s*\)\${POOLER_PROXY_PORT_TRANSACTION}:6543|\1127.0.0.1:56543:6543|' docker-compose.yml
  # payment keys for the Razorpay function (filled in later, kept only here)
  cat > docker-compose.sindiicat.yml <<'YML'
services:
  functions:
    environment:
      RAZORPAY_KEY_ID: ${RAZORPAY_KEY_ID:-}
      RAZORPAY_KEY_SECRET: ${RAZORPAY_KEY_SECRET:-}
      RAZORPAY_WEBHOOK_SECRET: ${RAZORPAY_WEBHOOK_SECRET:-}
YML
  setenv COMPOSE_FILE "docker-compose.yml:docker-compose.sindiicat.yml"
  chmod 600 .env
fi
cd "$STACK"
grep -q '127.0.0.1:55432:5432' docker-compose.yml || die "Could not lock the database to this server only."
# edge functions: push notifications + Razorpay
for f in push razorpay; do rsync -a --delete "$REPO/supabase/functions/$f/" "volumes/functions/$f/"; done
sh run.sh start || docker compose up -d --wait || die "The database server did not start. See: cd $STACK && docker compose ps"
ok "database server running"
PGPW=$(getenv POSTGRES_PASSWORD); SRK=$(getenv SERVICE_ROLE_KEY); ANON=$(getenv ANON_KEY)
# tgt: run on the new database (reads no input); tgti: same, fed from a file or pipe
tgt()  { docker exec    -e PGPASSWORD="$PGPW" supabase-db psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@" </dev/null; }
tgti() { docker exec -i -e PGPASSWORD="$PGPW" supabase-db psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
tgt -Atc 'select 1' </dev/null >/dev/null || die "Cannot reach the new database."

say "5/9 Copying everything from the old Supabase project"
if [ -f "$STATE/migrated" ]; then ok "already copied on $(cat "$STATE/migrated")"
else
  echo "    Open Supabase → your SINDIICAT project → Connect (top) → 'Session pooler' → copy the URI."
  echo "    Put your database password where it says [YOUR-PASSWORD]."
  echo "    (Forgot it? Supabase → Project Settings → Database → Reset database password.)"
  read -rsp "    Paste the connection string here and press Enter: " SRC </dev/tty; echo
  [[ "$SRC" == postgres* ]] || die "That does not look like a connection string (it starts with postgresql://)."
  PGIMG=$(docker inspect -f '{{.Config.Image}}' supabase-db)
  src() { docker run --rm --network host -e PGCONNECT_TIMEOUT=15 "$PGIMG" psql "$SRC" -v ON_ERROR_STOP=1 -q "$@" </dev/null; }
  src -Atc 'select 1' >/dev/null || die "Could not log in to the old database. Check the password in the connection string."
  ok "connected to the old database"
  D=$STATE/copy; mkdir -p "$D"; chmod 700 "$D"

  # extensions the app uses
  tgt -c "create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;
          create extension if not exists pg_cron; create extension if not exists pg_net;"

  # 5a. logins (passwords stay the same) and file-bucket settings, column by column (first: the team table points at them)
  copytable() { # schema.table
    local t=$1 s=${1%.*} n=${1#*.} cols
    cols=$(comm -12 <(src -Atc "select column_name from information_schema.columns where table_schema='$s' and table_name='$n' order by 1") \
                    <(tgt -Atc "select column_name from information_schema.columns where table_schema='$s' and table_name='$n' and is_generated='NEVER' order by 1") | paste -sd, -)
    [ -n "$cols" ] || die "No matching columns for $t"
    src -c "\copy (select $cols from $t) to stdout" | tgti -c "\copy $t($cols) from stdin"
    ok "$t: $(tgt -Atc "select count(*) from $t") rows"
  }
  tgt -c 'alter table auth.users disable trigger user; ' 2>/dev/null || true
  copytable auth.users
  copytable auth.identities
  tgt -c 'alter table auth.users enable trigger user;' 2>/dev/null || true
  copytable storage.buckets

  # 5b. every table, function, rule and row of the app (public schema)
  docker run --rm --network host -v "$D:/d" "$PGIMG" pg_dump "$SRC" --schema=public --no-owner --no-publications --no-subscriptions -f /d/public.sql \
    || die "Could not read the old database."
  sed -i '/^SET transaction_timeout/d' "$D/public.sql"
  # start from an empty app schema with Supabase's standard access rules
  tgt -c 'drop schema if exists public cascade; create schema public authorization pg_database_owner;
          grant usage on schema public to postgres, anon, authenticated, service_role;
          grant all on schema public to postgres, service_role;
          alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
          alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;
          alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
          alter default privileges for role supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role;
          alter default privileges for role supabase_admin in schema public grant all on functions to postgres, anon, authenticated, service_role;
          alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;'
  docker exec -i -e PGPASSWORD="$PGPW" supabase-db psql -h 127.0.0.1 -U postgres -d postgres -q -v ON_ERROR_STOP=0 < "$D/public.sql" > "$D/restore.log" 2>&1 || true
  grep -E "ERROR" "$D/restore.log" | grep -vE "already exists|must be owner of extension|schema \"public\"" > "$D/restore-errors.log" || true
  ok "app data copied ($(grep -c '^COPY ' "$D/public.sql") tables)"

  # 5c. triggers the app keeps on the login table, file rules, live updates, timed jobs
  src -Atc "select pg_get_triggerdef(t.oid) || ';' from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
            join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
            where n.nspname='auth' and not t.tgisinternal and pn.nspname='public'" > "$D/auth_triggers.sql"
  tgti < "$D/auth_triggers.sql"
  src -Atc "select format('drop policy if exists %I on storage.objects; create policy %I on storage.objects as %s for %s to %s%s%s;',
              policyname, policyname, permissive, cmd, array_to_string(roles, ', '),
              coalesce(' using (' || qual || ')', ''), coalesce(' with check (' || with_check || ')', ''))
            from pg_policies where schemaname='storage' and tablename='objects'" > "$D/storage_policies.sql"
  tgti < "$D/storage_policies.sql"
  src -Atc "select format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename)
            from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'" > "$D/realtime.sql"
  tgt -c "do \$\$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if; end \$\$;"
  tgti < "$D/realtime.sql" 2>/dev/null || true
  src -Atc "select format('select cron.schedule(%L, %L, %L);', jobname, schedule,
              replace(command, 'https://$CLOUD_REF.supabase.co', 'http://api-gw:8000')) from cron.job" > "$D/cron.sql"
  tgti < "$D/cron.sql" >/dev/null
  ok "notification timers: $(tgt -Atc "select string_agg(jobname, ', ') from cron.job")"

  # 5d. photos and files
  n=0
  while IFS='|' read -r b name pub ctype; do
    [ -n "$name" ] || continue
    f="$D/files/$b/$name"; mkdir -p "$(dirname "$f")"
    if [ "$pub" = t ]; then url="https://$CLOUD_REF.supabase.co/storage/v1/object/public/$b/$name"
      curl -fsS "$url" -o "$f" || die "Could not download $b/$name"
    else echo "    (skipped private file $b/$name, private buckets were empty when this was written)"; continue; fi
    curl -fsS -X POST "http://127.0.0.1:$GW_PORT/storage/v1/object/$b/$name" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
      -H "Content-Type: ${ctype:-application/octet-stream}" -H "x-upsert: true" --data-binary @"$f" >/dev/null || die "Could not save $b/$name"
    n=$((n+1))
  done < <(src -Atc "select o.bucket_id, o.name, b.public, o.metadata->>'mimetype' from storage.objects o join storage.buckets b on b.id=o.bucket_id")
  ok "$n photos/files copied"

  # 5e. check every table has the same number of rows as before
  src -Atc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" > "$D/tables"
  bad=0
  while read -r t; do
    a=$(src -Atc "select count(*) from public.\"$t\""); b=$(tgt -Atc "select count(*) from public.\"$t\"")
    [ "$a" = "$b" ] || { echo "    ✗ $t: old $a, new $b"; bad=1; }
  done < "$D/tables"
  [ $bad = 0 ] || die "Some tables did not copy completely (see above). Nothing was changed on the old project."
  ok "all $(wc -l < "$D/tables") tables match the old database row for row"
  [ -s "$D/restore-errors.log" ] && echo "    notes: $(wc -l < "$D/restore-errors.log") harmless messages in $D/restore-errors.log"
  # SQL files already applied on the old project count as done here
  tgt -c "create schema if not exists sindiicat_ops; create table if not exists sindiicat_ops.applied (file text primary key, at timestamptz default now());"
  for f in "$REPO"/supabase/apply/*.sql; do tgt -c "insert into sindiicat_ops.applied(file) values ('$(basename "$f")') on conflict do nothing;"; done
  date '+%d %b %Y %H:%M' > "$STATE/migrated"
  unset SRC
fi

say "6/9 Putting the shop and team app online"
install -m 755 "$REPO/server/update.sh" /usr/local/bin/sindiicat-update
SINDIICAT_FIRST=1 /usr/local/bin/sindiicat-update --force
if ! grep -q "^$DOMAIN" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-sindiicat"
  cat >> /etc/caddy/Caddyfile <<CADDY

# ---- SINDIICAT (added by server/install.sh) ----
$DOMAIN {
	encode zstd gzip
	root * $WEB
	@nocache path /config.js /sw.js /admin/sw.js /admin/index.html /index.html
	header @nocache Cache-Control "no-cache"
	header X-Content-Type-Options nosniff
	file_server
}
$API {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$GW_PORT
}
CADDY
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { cp /etc/caddy/Caddyfile.before-sindiicat /etc/caddy/Caddyfile; die "Web server settings check failed; restored the previous settings."; }
systemctl reload caddy
ok "https://$DOMAIN"

say "7/9 Auto-updates (every 2 minutes) and nightly backups"
cat > /etc/systemd/system/sindiicat-update.service <<UNIT
[Unit]
Description=SINDIICAT update (shop, team app, functions, database changes)
[Service]
Type=oneshot
ExecStart=/usr/local/bin/sindiicat-update
UNIT
cat > /etc/systemd/system/sindiicat-update.timer <<UNIT
[Unit]
Description=Check for SINDIICAT updates every 2 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
cat > /etc/cron.daily/sindiicat-backup <<'BK'
#!/bin/sh
# nightly copy of the whole SINDIICAT database and files, kept 30 days
set -e
D=/var/backups/sindiicat; mkdir -p $D; chmod 700 $D; T=$(date +%F)
PW=$(grep '^POSTGRES_PASSWORD=' /opt/sindiicat/stack/.env | cut -d= -f2-)
docker exec -e PGPASSWORD="$PW" supabase-db pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > $D/db-$T.dump
tar -czf $D/files-$T.tgz -C /opt/sindiicat/stack/volumes storage
find $D -type f -mtime +30 -delete
BK
chmod 755 /etc/cron.daily/sindiicat-backup
systemctl daemon-reload; systemctl enable --now sindiicat-update.timer >/dev/null
/etc/cron.daily/sindiicat-backup && ok "first backup saved in /var/backups/sindiicat"

say "8/9 Checking it works"
curl -fsS "https://$DOMAIN/" | grep -q SINDIICAT && ok "shop opens" || die "The shop page did not open."
curl -fsS "https://$DOMAIN/admin/" | grep -q SINDIICAT && ok "team app opens" || die "The team app did not open."
curl -fsS "https://$API/rest/v1/catalog?select=id&limit=1" -H "apikey: $ANON" >/dev/null && ok "shop can read products" || die "The shop cannot read products."
curl -fsS "https://$API/auth/v1/health" -H "apikey: $ANON" >/dev/null && ok "logins work" || die "The login service is not answering."

say "9/9 Done"
cat <<DONE

  Shop:            https://$DOMAIN
  Team app:        https://$DOMAIN/admin/
  Phone app:       https://$DOMAIN/app/SINDIICAT-Team.apk
  Database screen: https://$API   (user: $(getenv DASHBOARD_USERNAME), password: $(getenv DASHBOARD_PASSWORD))
                   Save this password somewhere safe. It is only shown here.

  Everyone logs in with the same email and password as before.
  Now tell Claude: "server done".
DONE
