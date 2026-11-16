#!/usr/bin/env bash
#
# Provision (or refresh) one pace-v0 env on app-server-02.
#
#   sudo _deploy/scripts/install.sh <env>      # env = sbx | uat | prod
#
# Idempotent: safe to re-run. First run creates the service user + paths, builds
# the API venv, installs the systemd unit (+ per-env User drop-in), sudoers, and
# the Caddy route, then STOPS so you can fill in /etc/pace-<env>.env. A
# re-run (once secrets are populated) enables + starts the service.
#
# Prereqs:
#   - The repo is cloned at INSTALL_ROOT (the path the env file declares), and
#     this script is run from inside that clone.
#   - `uv` and `rsync` are on PATH; Caddy is installed + managed by the platform.
#   - You have sudo. INSTALL_ROOT and the env's dist dir are chowned to the
#     service user on exit. Only pace's OWN dirs are touched — never a
#     shared parent (so operator-app's `chown -R` and ours never collide).
#
# What it deliberately does NOT do (platform-owned on the shared host):
#   - install/upgrade the Caddy package, or edit the top-level Caddyfile
#   - touch /var/www/html itself or any operator-app path
set -euo pipefail

ENV="${1:?usage: sudo _deploy/scripts/install.sh <sbx|uat|prod>}"
case "$ENV" in
  sbx) REF=develop ;;
  uat) REF=uat ;;
  prod) REF=main ;;
  *) echo "install.sh: unknown env '$ENV' (want sbx|uat|prod)" >&2; exit 1 ;;
esac

[[ $EUID -eq 0 ]] || { echo "install.sh: must run as root (sudo)" >&2; exit 1; }

# Resolve the repo root from this script's location (_deploy/scripts/ -> repo).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="_deploy/envs/pace-${ENV}.env"
[[ -f "$ENV_FILE" ]] || { echo "install.sh: no env file: $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a   # ENV_NAME SERVICE_USER INSTALL_ROOT DIST_ROOT SPA_SEGMENT API_PORT …

# The repo MUST live at INSTALL_ROOT so the venv + systemd unit point at the
# right place (the unit's WorkingDirectory/ExecStart are /opt/synveon/pace-%i/…).
if [[ "$REPO_ROOT" != "$INSTALL_ROOT" ]]; then
    cat >&2 <<EOF
install.sh: repo must be cloned at INSTALL_ROOT.
    Expected:  ${INSTALL_ROOT}
    Found:     ${REPO_ROOT}
Move the clone to ${INSTALL_ROOT} (or fix INSTALL_ROOT in ${ENV_FILE}).
EOF
    exit 1
fi

command -v uv    >/dev/null || { echo "install.sh: 'uv' not on PATH (needed for the API venv)." >&2; exit 1; }
command -v rsync >/dev/null || { echo "install.sh: 'rsync' not on PATH (needed by deploy.sh)."  >&2; exit 1; }
# SQL Server (optional) goes through pyodbc, which needs Microsoft's ODBC driver
# on the host. Only checked when the deploy env file enables it.
if [[ -n "${SQLSERVER_HOST:-}" ]]; then
    SQLSERVER_DRIVER="${SQLSERVER_DRIVER:-ODBC Driver 18 for SQL Server}"
    odbcinst -q -d 2>/dev/null | grep -qF "[$SQLSERVER_DRIVER]" || {
        echo "install.sh: SQLSERVER_HOST is set but '$SQLSERVER_DRIVER' isn't installed." >&2
        echo "    Install msodbcsql18 + unixodbc (Microsoft's Linux ODBC driver docs), then re-run." >&2
        exit 1
    }
fi
SYSTEMCTL="$(command -v systemctl || echo /usr/bin/systemctl)"

SECRETS_FILE="/etc/pace-${ENV}.env"
DIST_DIR="${DIST_ROOT}/${SPA_SEGMENT}"      # e.g. /var/www/html/pace-sbx

echo "==> Installing pace env: ${ENV} (ref ${REF})"
echo "    Service user:  ${SERVICE_USER}"
echo "    Install root:  ${INSTALL_ROOT}"
echo "    Dist dir:      ${DIST_DIR}"
echo "    API port:      ${API_PORT}"
echo "    Secrets file:  ${SECRETS_FILE}"
echo ""

# ----------------------------------------------------------------------
# 1. Service user
#    /bin/bash, NOT nologin: deploy.sh does `ssh <user>@host "<cmds>"`, which a
#    nologin shell would refuse before the commands ever run.
# ----------------------------------------------------------------------
echo "==> [1/6] Service user: ${SERVICE_USER}"
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --home-dir "/home/${SERVICE_USER}" \
        --shell /bin/bash "$SERVICE_USER"
fi
usermod --shell /bin/bash "$SERVICE_USER"   # repair if a prior run used nologin

# ~/.ssh for the CI deploy key: sshd reads $HOME/.ssh/authorized_keys, and the
# user is --no-create-home, so create the home + .ssh ourselves (StrictModes needs
# them owned by the user and not group/world-writable). This is where the CI runbook
# (gitlab-setup.md §3) appends the deploy pubkey.
USER_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
USER_HOME="${USER_HOME:-/home/${SERVICE_USER}}"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$USER_HOME"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$USER_HOME/.ssh"
[[ -f "$USER_HOME/.ssh/authorized_keys" ]] || \
    install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0600 /dev/null "$USER_HOME/.ssh/authorized_keys"

# ----------------------------------------------------------------------
# 2. Ownership — only pace's OWN dirs (siblings of operator-app's tier dirs)
# ----------------------------------------------------------------------
echo "==> [2/6] Ownership on ${INSTALL_ROOT} and ${DIST_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$INSTALL_ROOT"
mkdir -p "$DIST_DIR"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$DIST_DIR"   # NOT DIST_ROOT (/var/www/html)

# ----------------------------------------------------------------------
# 3. API venv (uv-managed). HOME=INSTALL_ROOT since the user has --no-create-home.
# ----------------------------------------------------------------------
echo "==> [3/6] API venv at ${INSTALL_ROOT}/backend/.venv (uv sync --frozen)"
sudo -u "$SERVICE_USER" env HOME="$INSTALL_ROOT" \
    bash -c "cd '${INSTALL_ROOT}/backend' && uv sync --frozen"

# ----------------------------------------------------------------------
# 4. systemd unit + per-env User drop-in
#    One instance unit (pace-api@.service) serves all envs; the drop-in
#    pins this instance's User to the env's service user (base User is for uat/prod;
#    sbx gets its own). Writing it for every env is harmless + idempotent.
# ----------------------------------------------------------------------
echo "==> [4/6] systemd unit + drop-in for pace-api@${ENV}"
install -m 0644 -o root -g root \
    _deploy/systemd/pace-api@.service /etc/systemd/system/pace-api@.service
install -d "/etc/systemd/system/pace-api@${ENV}.service.d"
printf '[Service]\nUser=%s\n' "$SERVICE_USER" \
    > "/etc/systemd/system/pace-api@${ENV}.service.d/user.conf"

# Sudoers so deploy.sh / CI can restart (+ check) the unit without a password.
# Locked to exact commands — no wildcards.
SUDOERS_FILE="/etc/sudoers.d/pace-api-${ENV}"
cat > "$SUDOERS_FILE" <<EOF
${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL} restart pace-api@${ENV}, ${SYSTEMCTL} status pace-api@${ENV}
EOF
chmod 0440 "$SUDOERS_FILE"; chown root:root "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

# ----------------------------------------------------------------------
# 5. Caddy route (static, all three envs) + secret env template
# ----------------------------------------------------------------------
echo "==> [5/6] Caddy route + secret file"
# Per-env route fragment → /etc/caddy/app-routes/, picked up by the existing
# `import /etc/caddy/app-routes/*.caddy` in the apps.example.com site block.
# Only THIS env's routes are installed (no premature routes for unprovisioned envs).
install -d /etc/caddy/app-routes
install -m 0644 -o root -g root \
    "_deploy/caddy/pace-${ENV}.caddy" "/etc/caddy/app-routes/pace-${ENV}.caddy"

NEED_SECRETS=0
if [[ ! -f "$SECRETS_FILE" ]]; then
    # One template for all envs: fill POSTGRES_URL's coordinates from this env's
    # file so uat/prod never start out pointed at sbx's database.
    : "${PG_USER:?missing in $ENV_FILE}" "${PG_HOST:?missing in $ENV_FILE}" \
      "${PG_PORT:?missing in $ENV_FILE}" "${PG_DATABASE:?missing in $ENV_FILE}"
    rendered="$(mktemp)"
    sed -e "s|{{PG_USER}}|${PG_USER}|g" -e "s|{{PG_HOST}}|${PG_HOST}|g" \
        -e "s|{{PG_PORT}}|${PG_PORT}|g" -e "s|{{PG_DATABASE}}|${PG_DATABASE}|g" \
        _deploy/envs/pace.secrets.env.example > "$rendered"
    install -m 0640 -o root -g "$SERVICE_USER" "$rendered" "$SECRETS_FILE"
    rm -f "$rendered"
    NEED_SECRETS=1
else
    # keep the group correct if the env's service user changed
    chgrp "$SERVICE_USER" "$SECRETS_FILE"; chmod 0640 "$SECRETS_FILE"
fi
# Only inspect VALUE lines — strip comments first so prose that mentions CHANGEME
# (or a commented-out optional var) can't falsely gate the service start.
if grep -vE '^[[:space:]]*#' "$SECRETS_FILE" | grep -qE 'CHANGEME|CHANGE_ME'; then NEED_SECRETS=1; fi

# ----------------------------------------------------------------------
# 6. Enable + start (gated on secrets being populated)
# ----------------------------------------------------------------------
"$SYSTEMCTL" daemon-reload

if [[ "$NEED_SECRETS" -eq 1 ]]; then
    cat <<EOF

==> [6/6] STOP — fill in real secrets before the service can start:
      sudo nano ${SECRETS_FILE}
    Set the POSTGRES_URL password.
    Optional secrets, only for sources enabled in _deploy/envs/pace-${ENV}.env:
      SQLSERVER_PASSWORD
    Clear any CHANGEME on a value line. Then re-run:
      sudo _deploy/scripts/install.sh ${ENV}

EOF
    exit 0
fi

echo "==> [6/6] Enabling + starting pace-api@${ENV}"
"$SYSTEMCTL" enable --now "pace-api@${ENV}"
"$SYSTEMCTL" show -p User "pace-api@${ENV}"      # expect User=${SERVICE_USER}
# Type=exec reports "started" before uvicorn binds, and a cold import (FastAPI +
# async SQLAlchemy) takes a few seconds — so poll /health (no DB dependency) for
# up to ~20s before warning, instead of checking once.
health_ok=0
for _ in $(seq 1 20); do
    if curl -fsS "localhost:${API_PORT}/health" >/dev/null 2>&1; then health_ok=1; break; fi
    sleep 1
done
if [[ "$health_ok" -eq 1 ]]; then
    echo "  health: ok (127.0.0.1:${API_PORT})"
else
    echo "  WARNING: localhost:${API_PORT}/health not ready after 20s. Check:" >&2
    echo "    systemctl status pace-api@${ENV} --no-pager -l" >&2
    echo "    journalctl -u pace-api@${ENV} -n 50 --no-pager" >&2
fi

# Reload Caddy ONLY if the active config validates — never flap the live host.
# If the Caddyfile doesn't import app-routes yet, our route is inert until the
# operator adds `import /etc/caddy/app-routes/*.caddy` to the apps.example.com block.
if ! grep -rqsF 'app-routes' /etc/caddy/Caddyfile /etc/caddy/conf.d/ 2>/dev/null; then
    echo "==> NOTE: active Caddy config does not import /etc/caddy/app-routes/*.caddy yet —" >&2
    echo "    ${SPA_BASE_PATH} is installed but NOT served. Add this line to the" >&2
    echo "    apps.example.com routes block, then reload Caddy:" >&2
    echo "        import /etc/caddy/app-routes/*.caddy" >&2
fi
if caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    "$SYSTEMCTL" reload caddy && echo "==> Caddy reloaded."
else
    echo "==> WARNING: 'caddy validate' failed — leaving the running Caddy untouched." >&2
fi

echo ""
echo "==> Done. Next: ./_deploy/scripts/deploy.sh ${ENV}  (build + ship the SPA), then"
echo "    open https://${SITE_HOSTNAME}${SPA_BASE_PATH}"
