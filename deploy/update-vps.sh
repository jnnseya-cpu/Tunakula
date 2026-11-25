#!/usr/bin/env bash
# ONE command to update a running Tunakula VPS to the latest code and rebuild everything built over this work.
#
#   bash deploy/update-vps.sh
#
# Run it from the Tunakula checkout on the VPS (the directory that holds deploy/.env.staging — find it with
# `docker compose ls` if unsure; it is the project whose config file ends in deploy/docker-compose.coexist.yml).
# It pulls the latest branch, rebuilds the API and both web apps, brings the stack up (the API applies any new
# database migrations on boot), waits for the API to be healthy, and prints the optional follow-up commands.
set -euo pipefail

BRANCH="${DEPLOY_BRANCH:-claude/exciting-turing-k5r4jb}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f deploy/.env.staging ] || { echo "deploy/.env.staging not found in $ROOT — run this from the Tunakula checkout the stack uses (see: docker compose ls)."; exit 2; }
C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml"

echo "== updating code to ${BRANCH} =="
git fetch origin --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "   now at: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

echo "== rebuilding images (API + customer + admin) =="
$C build --pull api customer-web admin-web

echo "== bringing the stack up (the API applies new DB migrations on boot) =="
$C up -d

echo "== waiting for the API to become healthy =="
for i in $(seq 1 60); do
  if $C exec -T api node -e "fetch('http://127.0.0.1:8080/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then echo "   API healthy"; break; fi
  [ "$i" -eq 60 ] && { echo "API did not become healthy"; $C logs --tail=80 api; exit 1; }
  sleep 3
done
$C ps

cat <<EOF

== Updated. Everything from ${BRANCH} is now live on this VPS. ==

Optional follow-ups (run only the ones you need):

  # Fast one-time Nutri-Score backfill for the DRC market (uses the AI key from admin → Integrations):
  ${C} exec -T api npm run backfill-nutrition -- CD

  # Stage a StackFood dump and promote it live (details: launch-audit/promotion-runbook.md):
  bash deploy/stage-from-dump.sh /srv/stackfood.sql
  ${C} exec -T api node --import tsx src/migrator/promote.ts CD            # dry run
  ${C} exec -T api node --import tsx src/migrator/promote.ts CD --apply --publish
EOF
