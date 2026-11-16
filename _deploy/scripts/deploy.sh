#!/usr/bin/env bash
#
# Deploy pace-v0 to a path-routed env on the shared host.
#
#   ./_deploy/scripts/deploy.sh sbx   # build + ship + restart
#
# Run from the repo root, on a machine that can SSH to TARGET_HOST as
# SERVICE_USER and that has node + uv installed. Reads the committed,
# non-secret _deploy/envs/pace-<env>.env for orchestration values.
#
# Assumes host provisioning is already done (_deploy/scripts/install.sh <env>):
#   - git checkout at INSTALL_ROOT
#   - /etc/pace-<env>.env secret file
#   - systemd unit pace-api@<env> + Caddy route
set -euo pipefail

ENV="${1:?usage: _deploy/scripts/deploy.sh <sbx|uat|prod>}"
ENV_FILE="_deploy/envs/pace-${ENV}.env"
[ -f "$ENV_FILE" ] || { echo "error: $ENV_FILE not found (run from repo root)" >&2; exit 1; }

# Load non-secret deploy config (ENV_NAME, TARGET_HOST, SERVICE_USER, ports, …).
set -a; . "$ENV_FILE"; set +a

# Branch that feeds each env: develop→sbx, uat→uat, main→prod.
case "$ENV" in
  sbx) REF=develop ;;
  uat) REF=uat ;;
  prod) REF=main ;;
  *) echo "error: unknown env '$ENV'" >&2; exit 1 ;;
esac

HOST="${SERVICE_USER}@${TARGET_HOST}"

echo "==> [1/3] Building SPA (base ${SPA_BASE_PATH})"
( cd frontend && npm ci && npm run "build:${BUILD_TARGET}" )

echo "==> [2/3] Updating backend checkout on ${TARGET_HOST} (ref ${REF})"
ssh "$HOST" "set -euo pipefail
  cd '${INSTALL_ROOT}'
  git fetch --all --prune
  git checkout '${REF}'
  git pull --ff-only
  cd backend && uv sync --frozen"

# NOTE: deploys do NOT touch the database. Schema setup is a one-time manual step
# per env (uv run python -m scripts.postgres.setup_db); see _deploy/README.md.

# Dist goes to DIST_ROOT/SPA_SEGMENT (shared-host convention
# /var/www/html/<tier>/<segment>); SPA_SEGMENT is the URL base path component
# Caddy serves under, which is `pace` for prod (base /pace/), not
# ENV_NAME. See _deploy/envs/pace-<env>.env and _deploy/README.md.
echo "==> [3/3] Shipping SPA → ${DIST_ROOT}/${SPA_SEGMENT}/ and restarting API"
ssh "$HOST" "mkdir -p '${DIST_ROOT}/${SPA_SEGMENT}'"
rsync -az --delete frontend/dist/ "${HOST}:${DIST_ROOT}/${SPA_SEGMENT}/"
ssh "$HOST" "sudo systemctl restart pace-api@${ENV}"

echo "Done → https://${SITE_HOSTNAME}${SPA_BASE_PATH}"
