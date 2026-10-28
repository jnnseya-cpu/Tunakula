#!/usr/bin/env bash
# Stage a StackFood .sql dump into the reviewable migration.* schema WITHOUT hand-wiring any MySQL.
#
# It spins up a throwaway MariaDB on the coexist stack's internal network (so the `api` container's migrator can
# reach it by name), loads the dump, applies the two older-install compatibility shims, runs the migrator, then
# removes the MariaDB (anonymous data volume, so nothing lingers). Promotion is a SEPARATE step afterwards.
#
#   bash deploy/stage-from-dump.sh /path/to/stackfood.sql
#   KEEP_MYSQL=1 bash deploy/stage-from-dump.sh dump.sql     # leave the MariaDB up (to inspect it)
#   STACKFOOD_DB_PASSWORD=… bash deploy/stage-from-dump.sh …  # override the throwaway root password
#
# Run it from anywhere inside the Tunakula repo checkout (the one with deploy/.env.staging). After it finishes,
# promote with:  docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml \
#                  exec -T api node --import tsx src/migrator/promote.ts CD
set -euo pipefail

DUMP="${1:-}"
[ -n "$DUMP" ] || { echo "usage: bash deploy/stage-from-dump.sh <path-to-stackfood.sql>"; exit 2; }
[ -f "$DUMP" ] || { echo "dump not found: $DUMP"; exit 2; }

# Resolve the repo root from this script's location, so it works from any cwd.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f deploy/.env.staging ] || { echo "deploy/.env.staging not found in $ROOT — run this from the Tunakula checkout the coexist stack uses."; exit 2; }

C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml"
PW="${STACKFOOD_DB_PASSWORD:-stackfood}"
COUNTRY="${COUNTRY:-CD}"

cleanup() {
  if [ "${KEEP_MYSQL:-0}" = "1" ]; then
    echo "== KEEP_MYSQL=1 — leaving the staging MariaDB running (remove later with: $C --profile migrate rm -sfv stackfood-mysql) =="
  else
    echo "== removing the throwaway MariaDB =="
    $C --profile migrate rm -sfv stackfood-mysql >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "== starting a throwaway MariaDB on the coexist network =="
$C --profile migrate up -d stackfood-mysql

echo "== waiting for it to become healthy =="
for i in $(seq 1 40); do
  if $C exec -T stackfood-mysql healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; then echo "  ready"; break; fi
  [ "$i" -eq 40 ] && { echo "MariaDB did not become healthy"; $C --profile migrate logs --tail=40 stackfood-mysql; exit 1; }
  sleep 3
done

echo "== loading the dump ($(du -h "$DUMP" | cut -f1)) into the stackfood database =="
$C exec -T stackfood-mysql mariadb -uroot -p"$PW" stackfood < "$DUMP"

# Older single-module StackFood installs have no `modules` table and no `restaurants.module_id`; the migrator's
# branch query joins them. Add empty, nullable stand-ins (idempotent) so the join runs and store type falls back
# to RESTAURANT. This touches ONLY this throwaway copy of the dump, never your live data.
echo "== applying older-install compatibility shims (idempotent) =="
$C exec -T stackfood-mysql mariadb -uroot -p"$PW" stackfood <<'SQL'
CREATE TABLE IF NOT EXISTS modules (id BIGINT PRIMARY KEY, module_type VARCHAR(64), module_name VARCHAR(191));
SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name='restaurants' AND column_name='module_id');
SET @ddl := IF(@has = 0, 'ALTER TABLE restaurants ADD COLUMN module_id BIGINT NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SQL

echo "== staging into migration.* via the api container (dry-run reconcile + load) =="
$C exec -T -e STACKFOOD_MYSQL_URL="mysql://root:$PW@stackfood-mysql:3306/stackfood" \
  api node --import tsx src/migrator/run.ts --apply

cat <<EOF

== Staging complete. The migration.* schema now holds the reviewable records. ==
Next, dry-run the promotion, then go live:
  $C exec -T api node --import tsx src/migrator/promote.ts $COUNTRY
  $C exec -T api node --import tsx src/migrator/promote.ts $COUNTRY --apply --publish
EOF
