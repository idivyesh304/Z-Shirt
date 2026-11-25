#!/usr/bin/env bash
# Replaces SINDIICAT's server keys with fresh ones nobody has seen.
# Changes: the login-signing secret and API keys (old ones stop working),
# the database-screen password, and internal session secrets.
# Everyone logs in again once with their same email and password.
# Run as root:  bash /opt/sindiicat/repo/server/rotate-keys.sh
set -euo pipefail
STACK=/opt/sindiicat/stack
cd "$STACK"
[ -f .env ] || { echo "SINDIICAT is not installed here."; exit 1; }
cp .env "/var/lib/sindiicat/env-before-rotation-$(date +%F-%H%M)"; chmod 600 /var/lib/sindiicat/env-before-rotation-*
setenv() { awk -v k="$1" -v v="$2" 'BEGIN{d=0} index($0, k "=") == 1 { print k "=" v; d=1; next } { print } END{ if (!d) print k "=" v }' .env > .env.tmp && mv .env.tmp .env; }
NEW=$(sh utils/generate-keys.sh 2>/dev/null </dev/null | grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY|SECRET_KEY_BASE|DASHBOARD_PASSWORD|LOGFLARE_PUBLIC_ACCESS_TOKEN|LOGFLARE_PRIVATE_ACCESS_TOKEN)=' || true)
[ "$(echo "$NEW" | grep -c .)" = 7 ] || { echo "Could not make new keys. Nothing was changed."; exit 1; }
while IFS= read -r line; do setenv "${line%%=*}" "${line#*=}"; done <<< "$NEW"
sh utils/add-new-auth-keys.sh --update-env >/dev/null 2>&1 </dev/null || { cp "$(ls -t /var/lib/sindiicat/env-before-rotation-* | head -1)" .env; echo "Could not make the new login keys. Put the old settings back."; exit 1; }
chmod 600 .env
echo "==> Restarting with the new keys (about a minute)"
sh run.sh recreate >/dev/null 2>&1 </dev/null || docker compose up -d --force-recreate --wait >/dev/null 2>&1 </dev/null
/usr/local/bin/sindiicat-update --force >/dev/null
curl -fsS "https://api.sindiicat.dzynlabpvtltd.com/auth/v1/health" -H "apikey: $(awk -F= '$1=="ANON_KEY"{print substr($0, index($0,"=")+1)}' .env)" >/dev/null \
  && echo "✓ New keys are live. Shop and team app already use them." || echo "✗ Login service did not answer yet; wait a minute and open the team app."
echo
echo "  New database-screen password: $(awk -F= '$1=="DASHBOARD_PASSWORD"{print substr($0, index($0,"=")+1)}' .env)"
echo "  (user: $(awk -F= '$1=="DASHBOARD_USERNAME"{print substr($0, index($0,"=")+1)}' .env))  Save it now; it is only shown here."
echo "  Now tell Claude: \"keys done\"."
