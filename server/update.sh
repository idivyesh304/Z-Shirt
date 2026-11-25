#!/usr/bin/env bash
# sindiicat-update: keeps the server in step with SINDIICAT's code. Runs every 2 minutes
# (sindiicat-update.timer). Brings in: shop + team app pages, notification/payment
# functions, new database changes (supabase/apply/*.sql, each applied once), new phone app.
# "--force" redoes the pages and functions even when nothing changed.
set -euo pipefail
APP=/opt/sindiicat; REPO=$APP/repo; STACK=$APP/stack; WEB=/srv/sindiicat; STATE=/var/lib/sindiicat
DOMAIN=sindiicat.dzynlabpvtltd.com; API=api.sindiicat.dzynlabpvtltd.com
exec 9>/run/sindiicat-update.lock; flock -n 9 || exit 0
FORCE="${1:-}"
getenv() { awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$STACK/.env"; }
say() { echo "[sindiicat-update] $*"; }

cd "$REPO"
git fetch -q origin main
OLD=$(git rev-parse HEAD); NEW=$(git rev-parse origin/main)
REL=$(curl -fsS https://api.github.com/repos/idivyesh304/Z-Shirt/releases/latest 2>/dev/null | jq -r '.tag_name // empty' || true)
[ "$OLD" = "$NEW" ] && [ "$FORCE" != "--force" ] && [ "$REL" = "$(cat "$STATE/apk-tag" 2>/dev/null)" ] && exit 0
CHANGED=$(git diff --name-only "$OLD" "$NEW" || true)
git reset -q --hard origin/main

# 1. pages: shop at /, team app at /admin/, settings pointed at this server
if [ "$OLD" != "$NEW" ] || [ "$FORCE" = "--force" ]; then
  rsync -a --delete --exclude config.js --exclude app/ "$REPO/web/" "$WEB/"
  sed -e "s|SUPABASE_URL: *'[^']*'|SUPABASE_URL: 'https://$API'|" \
      -e "s|SUPABASE_ANON_KEY: *'[^']*'|SUPABASE_ANON_KEY: '$(getenv ANON_KEY)'|" \
      -e "s|SHOP_URL: *'[^']*'|SHOP_URL: 'https://$DOMAIN/'|" "$REPO/web/config.js" > "$WEB/config.js.new"
  mv "$WEB/config.js.new" "$WEB/config.js"
  chmod -R a+rX "$WEB"
  say "pages updated to $(git rev-parse --short HEAD)"
fi

# 2. notification + payment functions
if [ "$FORCE" = "--force" ] || echo "$CHANGED" | grep -q '^supabase/functions/'; then
  for f in push razorpay; do rsync -a --delete "$REPO/supabase/functions/$f/" "$STACK/volumes/functions/$f/"; done
  [ -n "${SINDIICAT_FIRST:-}" ] || (cd "$STACK" && docker compose restart functions >/dev/null)
  say "functions updated"
fi

# 3. database changes, oldest first, each once; stops at the first one that fails
PW=$(getenv POSTGRES_PASSWORD)
db() { docker exec -i -e PGPASSWORD="$PW" supabase-db psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
for f in $(ls "$REPO"/supabase/apply/*.sql 2>/dev/null | sort -V); do
  n=$(basename "$f")
  [ "$(db -Atc "select 1 from sindiicat_ops.applied where file = '$n'")" = 1 ] && continue
  if db -1 < "$f" > "$STATE/last-sql.log" 2>&1; then
    db -c "insert into sindiicat_ops.applied(file) values ('$n')"; say "database change applied: $n"
  else say "database change FAILED: $n (see $STATE/last-sql.log)"; break; fi
done

# 4. phone app download
if [ -n "$REL" ] && [ "$REL" != "$(cat "$STATE/apk-tag" 2>/dev/null)" ]; then
  mkdir -p "$WEB/app"
  if curl -fsSL "https://github.com/idivyesh304/Z-Shirt/releases/download/$REL/SINDIICAT-Team.apk" -o "$WEB/app/SINDIICAT-Team.apk.new"; then
    mv "$WEB/app/SINDIICAT-Team.apk.new" "$WEB/app/SINDIICAT-Team.apk"; echo "$REL" > "$STATE/apk-tag"; chmod -R a+rX "$WEB/app"
    say "phone app $REL ready"
  fi
fi
