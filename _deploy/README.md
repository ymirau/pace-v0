# Deploying pace-v0

This app runs behind Synveon's shared platform: **one Azure App Proxy → one Caddy on
`app-server-02`**, with environments distinguished by **URL path** (not hostname).

> 📊 For a high-level visual overview (CI promotion, a deploy run, host
> provisioning, and the runtime request flow), see **[ARCHITECTURE.md](ARCHITECTURE.md)**.
>
> 🆕 **Brand-new app, no GitLab project yet?** Start with
> **[gitlab-repo-setup.md](gitlab-repo-setup.md)** — create the repo, add `origin`,
> and push `develop`/`uat`/`main` (for a GitHub repo instead, `/syn-init-github` does it for you).
> Everything below assumes that's done.

| Env | URL | Vite base | API port* |
|-----|-----|-----------|-----------|
| sbx | `https://apps.example.com/pace-sbx/` | `/pace-sbx/` | 8014 |
| uat | `https://apps.example.com/pace-uat/` | `/pace-uat/` | 8013 |
| prod | `https://apps.example.com/pace/` | `/pace/` | 8012 |

\* Ports must be unique on the shared host — **confirm a free block with the platform owner.**

## How a request flows

1. Browser → `https://apps.example.com/pace-sbx/...` → Azure App Proxy (terminates TLS) → Caddy on `:80`.
2. Caddy routes by path:
   - `/pace-sbx/api/*` → **strips the `/pace-sbx` prefix** → `reverse_proxy localhost:8014`. The backend therefore sees `/api/*` — which is why FastAPI mounts its routes under `/api` (see [backend/main.py](../backend/main.py)).
   - `/pace-sbx/*` → static SPA from `DIST_ROOT`, with `try_files … /pace-sbx/index.html` for client-side routing.
3. The SPA is **built with its base path baked in** (`npm run build:sbx|uat|prod`), so asset URLs, the API base, and the React Router `basename` all resolve under the env's sub-path automatically — all derived from `import.meta.env.BASE_URL`. (The MSAL `redirectUri` is the exception: it's the shared, path-independent `/auth-callback/`.)

## Shared-host gotchas (learned the hard way — read before first deploy)

These all surfaced bringing the first app up on this host. The template already bakes in the
fixes; this is *why* they're there, so you don't undo them.

1. **Trailing slashes must agree, or you get a blank page / broken login.** Two separate places:
   - **The app's own base path.** A visitor can land on the bare `/pace-sbx` (no slash). The React
     Router `basename` strips the trailing slash (`BASE_URL.replace(/\/$/, "") || "/"`,
     [frontend/src/routes.tsx](../frontend/src/routes.tsx)) so it matches either form, and Caddy
     redirects bare `/pace-sbx` → `/pace-sbx/` (otherwise it matches no `handle` and returns an
     empty `200` — a blank document). See the per-env fragment in `_deploy/caddy/`.
   - **The MSAL redirect URI.** Login goes through the shared `/auth-callback/` (not the app's own
     path). Its trailing slash must match the single Azure SPA redirect URI
     `https://apps.example.com/auth-callback/` **exactly** — a mismatch is the #1 silent login
     failure. See the toolkit's `auth-callback/` project.
2. **Caddy redirect targets must be RELATIVE.** App Proxy's Internal URL means requests reach Caddy
   with `Host: app-server-02.example.com`. An absolute `redir` target embeds that internal host in
   `Location` and leaks it to external clients. Keep targets relative (`redir … /pace-sbx/`). The
   matcher is also **namespaced** (`@pace_<env>_noslash`) because the fragment shares the
   `apps.example.com` site block with operator-app.
3. **Caddy config is NOT shipped by CI.** `_deploy/scripts/deploy.sh` only builds/ships the SPA and
   restarts the API. The Caddy fragment is installed + reloaded by `_deploy/scripts/install.sh`
   (step 5, validate-gated). After any change to a `_deploy/caddy/*.caddy` file you must re-apply
   it on the host (`sudo install.sh <env>`, or copy into `/etc/caddy/app-routes/` + `caddy validate`
   + `systemctl reload caddy`).
4. **The token audience is the client-ID GUID, not the App ID URI.** The shared registration issues
   **v2.0** tokens, whose `aud` is the registration's client-ID GUID (`11111111-…`) — *not*
   `https://apps.example.com`. That GUID is the backend's built-in `AZURE_API_AUDIENCE` default
   (`backend/app/core/config.py`), so don't set it in any env file; leave `AZURE_ISSUER` unset too.
   A 401 `Invalid or expired token` right after login usually means one of them was overridden.
5. **Pick a unique `API_PORT` block.** The example ports above (`8012`–`8014`) are a *real other app's*
   ports — shipping them unchanged collides on the shared host. operator-app uses `8002`–`8004`;
   confirm a free block with the platform owner, then update it **everywhere it's hard-coded** and
   commit those changes together: the 3 env files (`_deploy/envs/pace-<env>.env`, `API_PORT=`), the
   3 Caddy fragments (`_deploy/caddy/pace-<env>.caddy`, `reverse_proxy localhost:<port>`), and
   the doc port references (this file, `ARCHITECTURE.md`, `gitlab-setup.md`). Changing only the env
   files leaves Caddy proxying to the old port. `/syn-provision-webapp-host` finds a free block
   and lists every line to change.

## Config split

Every env file in the app, local ones included, is listed in the root README's
[Config files](../README.md#config-files) table. The deployed ones:

- **`_deploy/envs/pace-<env>.env`** (committed, non-secret): deploy orchestration — paths, ports, base path, build target, Postgres coordinates, plus the coordinates of any **optional** data source (commented out = that feature disabled and its endpoints return 503; uncomment to enable). Both `_deploy/scripts/install.sh` and `_deploy/scripts/deploy.sh` source it (no host/user/path duplication). pace needs no `render.sh`: the systemd unit is a native `@.service` instance template and the Caddy config is static, so there are no per-env templates to render.
  - SQL Server: `SQLSERVER_HOST/PORT/DATABASE/USER`
  Email is not optional: every env file sets `MAIL_ENABLED/SMTP_HOST/SMTP_PORT/STARTTLS/SENDER`,
  `MAIL_REDIRECT_TO` (sbx/uat send everything to that inbox) and `SUPPORT_EMAIL` (where the
  Support page sends). The O365 relay needs no login, so none of it is secret.
- **`/etc/pace-<env>.env`** on the host (mode 0640, **never committed**): the backend's runtime secrets, loaded by the systemd unit via `EnvironmentFile` after the settings file (so a key in both takes this file's value). Rendered by `install.sh` from `_deploy/envs/pace.secrets.env.example`. Only `POSTGRES_URL` is required; the rest are optional and only needed when their source is enabled in the settings file above. Contents:
  ```
  POSTGRES_URL=postgresql+asyncpg://app_admin:<pw>@app-server-01:5432/<db>
  # Optional — only if enabled in _deploy/envs/pace-<env>.env:
  # SQLSERVER_PASSWORD=<pw>                  # SQL Server reports (/api/reports/*)
  # AUTH_DISABLED is NOT set here — deployed envs validate real tokens.
  ```

## On-host paths

`app-server-02` hosts several path-routed apps, so pace keeps its files in
**app-namespaced** directories that don't overlap operator-app's. Three values in
[_deploy/envs/pace-<env>.env](envs/) drive this:

| Var | sbx | uat | prod | Notes |
|-----|-----|-----|------|-------|
| `INSTALL_ROOT` | `/opt/synveon/pace-sbx` | `…/pace-uat` | `…/pace-prod` | Repo checkout. Sibling of operator-app's `/opt/synveon/<tier>` — its `chown -R INSTALL_ROOT` never reaches these. |
| `DIST_ROOT` | `/var/www/html` | `/var/www/html` | `/var/www/html` | The **parent** of the dist dir; Caddy's `root`. |
| `SPA_SEGMENT` | `pace-sbx` | `pace-uat` | `pace` | URL base component. The deploy rsyncs dist to `DIST_ROOT/SPA_SEGMENT/`; Caddy `try_files` adds it. |

So the built SPA lands at **`DIST_ROOT/SPA_SEGMENT/`** = `/var/www/html/pace-sbx/`
(sbx) and `/var/www/html/pace/` (prod, base `/pace/`). The Caddy
`handle /<segment>/*` block sets `root * /var/www/html` and
`try_files {path} /<segment>/index.html`, so a request to `/<segment>/x` resolves to
`/var/www/html/<segment>/x`, and the handle matcher scopes serving to that prefix.

**Why `DIST_ROOT` is the parent, not the dist dir itself:** Caddy resolves
`root + request-path`, and the request path already includes the `/<segment>/`
prefix — so the files must sit one level *below* `root`. Setting `DIST_ROOT` to the
dist dir would double it (`…/pace-sbx/pace-sbx/`). Making `DIST_ROOT` the
parent gives a single, clean `…/pace-sbx/`.

**Isolation from operator-app:** pace's dist dirs are **siblings** of
operator-app's `/var/www/html/<tier>` (e.g. `/var/www/html/sbx`), so operator-app's
`install.sh`, which does `chown -R "$DIST_ROOT"` over its own tier dir, can never
re-own or disturb pace's directories. [deploy.sh](scripts/deploy.sh) and the
per-env [caddy/pace-<env>.caddy](caddy/) fragments read these values —
keep all three in sync if you ever re-home an env. **`SPA_SEGMENT` is not `ENV_NAME`**: prod's
`ENV_NAME` is `pace-prod` but its segment is `pace` because its URL base
is `/pace/`.

## Human / infra prerequisites (cannot be done from this repo)

1. **Shared `/auth-callback/` (one-time per host, not per app)** — an Entra admin adds a **single** SPA redirect URI on the shared registration (`11111111-…`), used by every app and env:
   - `https://apps.example.com/auth-callback/`  *(trailing slash — must match exactly; set the same value as the post-logout URI)*

   The host also serves the callback bundle at `/var/www/html/auth-callback/` via a one-time Caddy fragment. Once this exists, **adding a new app needs no Azure change**. See the toolkit's `auth-callback/` project (its `README.md` for setup, `docs/MIGRATION.md` for moving existing per-path apps over).
2. **Token audience/issuer** — the shared registration issues **v2.0** tokens
   (confirmed by decoding a real token: `ver=2.0`, `iss=.../v2.0`). A v2.0 token's
   `aud` is the resource's **client-ID GUID** — `11111111-1111-1111-1111-111111111111`
   (the frontend's `SPA_CLIENT_ID`), **not** the App ID URI `https://apps.example.com`.
   The backend defaults `AZURE_TENANT_ID` and `AZURE_API_AUDIENCE` to the shared
   registration ([backend/app/core/config.py](../backend/app/core/config.py)), so no env file
   sets them; leave `AZURE_ISSUER` unset too. See [backend/app/core/security.py](../backend/app/core/security.py).
3. **Host provisioning on `app-server-02`** — the two service users (`synappssbx-pace` for sbx; `synapps-pace` for uat+prod), `INSTALL_ROOT`, `DIST_ROOT`, a unique `API_PORT`, the systemd unit (with `EnvironmentFile=/etc/pace-<env>.env` and the `@sbx` user drop-in), a sudoers grant for the restart, and a Caddy route snippet for `/pace-<env>/`. Steps below; CI/CD provisioning in [gitlab-setup.md](gitlab-setup.md).
4. **Database schema + grants** — the app role (`app_admin`) has no DDL rights, so a **DBA/owner** must create the schema + tables and grant the app role CRUD, once per env, by applying `backend/sql/postgres/*.sql` (incl. `999_grants.sql`) with an admin account. See **[Database setup](#database-setup-one-time-per-env)** below.

5. **SQL Server (only if the app enables it)** — Microsoft's **ODBC Driver 18 for SQL Server** (`msodbcsql18` + `unixodbc`) on the host; `install.sh` checks `odbcinst -q -d` and stops if it's missing while `SQLSERVER_HOST` is set. Network reachability from `app-server-02` to the SQL Server host (port 1433). A **least-privilege SQL login** for the app from the DBA: read-only unless the app writes, and only on the tables it uses.

## App-specific host artifacts (in this repo)

[scripts/install.sh](scripts/install.sh) installs these for you; the table is what
it puts where (and what to edit by hand):

| File | Goes to | Purpose |
|------|---------|---------|
| [scripts/install.sh](scripts/install.sh) | run on the host (sudo) | Idempotent provisioning: service user, ownership, venv, unit + drop-in, sudoers, Caddy route, secret-gating. |
| [scripts/deploy.sh](scripts/deploy.sh) | run from a workstation/CI | build SPA → update host checkout → migrate → rsync dist → restart. |
| [systemd/pace-api@.service](systemd/pace-api@.service) | `/etc/systemd/system/` | Instance systemd unit (`@sbx`/`@uat`/`@prod`); reads `API_PORT` from the deploy env file and secrets from `/etc/pace-<env>.env`. base `User=synapps-pace` + a per-env `User=` drop-in. |
| [caddy/pace-&lt;env&gt;.caddy](caddy/) | `/etc/caddy/app-routes/pace-<env>.caddy` (per env), picked up by the `apps.example.com` site block's `import .../app-routes/*.caddy` | That env's API + SPA `handle` routes (strips the env prefix → `/api/*`). |
| [envs/pace.secrets.env.example](envs/pace.secrets.env.example) | `/etc/pace-<env>.env` (0640) | Template for the **secret** runtime env, shared by every env. `install.sh` fills `POSTGRES_URL`'s user/host/port/database from `_deploy/envs/pace-<env>.env`; you edit in the real passwords (every `CHANGEME`). Never commit the real file. |

## First-time host provisioning — sbx (on `app-server-02`)

Run with the platform owner (needs sudo). Confirm `API_PORT=8014` is free, that
`uv` + `rsync` are on PATH, and the shared `/auth-callback/` is set up on the host (one-time).

**Service users (two):** SBX runs as **`synappssbx-pace`** (isolated); UAT and
PROD share **`synapps-pace`** (same prod-grade secrets). [scripts/install.sh](scripts/install.sh)
handles the user, ownership, venv, unit + per-env `User=` drop-in, sudoers, and the
Caddy route — all **idempotent** and scoped to pace's own (sibling) dirs.

```bash
# 1. Clone the repo AT INSTALL_ROOT (install.sh requires this), develop feeds sbx.
#    /var/www/html is not writable by the service user, so create + own the clone dir
#    with sudo first (install.sh chowns it to the service user on the way through).
sudo install -d -o "$USER" /opt/synveon/pace-sbx
git clone -b develop \
  git@gitlab.example.com:synveon/pace-v0.git \
  /opt/synveon/pace-sbx

# 2. Provision. First run installs everything, then STOPS so you can fill secrets.
cd /opt/synveon/pace-sbx
sudo _deploy/scripts/install.sh sbx

# 3. Fill in /etc/pace-sbx.env (the POSTGRES_URL password)
sudo nano /etc/pace-sbx.env

# 4. Re-run to enable + start the service (idempotent).
sudo _deploy/scripts/install.sh sbx
#    -> systemctl show -p User pace-api@sbx  => User=synappssbx-pace
#    -> curl -s localhost:8014/health              => ok

# 5. Caddy: install.sh installs /etc/caddy/app-routes/pace-sbx.caddy and reloads
#    (validate-gated). The chain is Caddyfile → conf.d/apps-host.caddy (the
#    apps.example.com site block) → import /etc/caddy/app-routes/*.caddy → our file.
#    operator-app already established that import on lx02, so nothing to add by hand;
#    install.sh prints a NOTE only if the import line is somehow missing. It never
#    edits the top-level Caddyfile (which would risk PROD).

# 6. Host → GitLab pull key. The deploy ('git fetch && checkout && pull') runs AS the
#    service user on lx02, so that user needs read access to the repo. Give it a
#    read-only deploy key:
sudo -u synappssbx-pace ssh-keygen -t ed25519 \
  -f /home/synappssbx-pace/.ssh/id_ed25519 -N "" -C "pace-host-pull@app-server-02"
sudo -u synappssbx-pace bash -c 'ssh-keyscan -H gitlab.example.com >> ~/.ssh/known_hosts'
sudo cat /home/synappssbx-pace/.ssh/id_ed25519.pub
#    → GitLab → pace → Settings → Repository → Deploy keys → add it, READ-ONLY.
#    Then confirm a pull works (no prompt):
sudo -u synappssbx-pace git -C /opt/synveon/pace-sbx fetch
```

**For uat/prod:** clone at their `INSTALL_ROOT`, then `sudo _deploy/scripts/install.sh uat`
(or `prod`). install.sh reads each env file, so it creates `synapps-pace`, writes
that env's `User=` drop-in + sudoers, and uses the right paths automatically — no manual
per-env differences. Step 6 (host-pull key) is **once per service user**, so uat and prod
share one key on `synapps-pace` — do it on the first of the two you provision.

> install.sh sets the service user's shell to **`/bin/bash`** (not `nologin`):
> [scripts/deploy.sh](scripts/deploy.sh) runs `ssh <user>@host "<cmds>"`, which a
> `nologin` shell would reject before the commands run.

### Wire CI for auto-deploy (one-time)

With the host provisioned, hook it up so a push to `develop` auto-deploys. Full
detail + rationale in [gitlab-setup.md](gitlab-setup.md); the ordered steps:

1. **Enable the shared runners for pace** *(GitLab UI; Maintainer on both projects)* —
   `synveon/platform` → Settings → CI/CD → Runners → edit the `docker` and `shell`
   runners → uncheck **"Lock to current projects."** Then pace → Settings →
   CI/CD → Runners → **Project runners** → **Enable for this project** on both.

2. **Generate the SBX deploy key + authorize it** *(on the runner host `ai-server-01`)*:
   ```bash
   sudo -u gitlab-runner ssh-keygen -t ed25519 \
     -f /home/gitlab-runner/.ssh/id_ed25519_pace_sbx \
     -N "" -C "gitlab-ci-pace-sbx@ai-server-01"
   printf "echo '%s' | sudo tee -a /home/synappssbx-pace/.ssh/authorized_keys >/dev/null\n" \
     "$(sudo cat /home/gitlab-runner/.ssh/id_ed25519_pace_sbx.pub)"
   ```
   That prints the command that appends the pubkey to `~synappssbx-pace/.ssh/authorized_keys`:
   copy the printed line and run it as is **on lx02** (`install.sh` already created the
   dir/file). Then verify the cross-host hop:
   ```bash
   sudo -u gitlab-runner bash -c 'ssh-keyscan -H app-server-02 >> /home/gitlab-runner/.ssh/known_hosts'
   sudo -u gitlab-runner ssh -i /home/gitlab-runner/.ssh/id_ed25519_pace_sbx \
     -o BatchMode=yes synappssbx-pace@app-server-02 'echo ok=$(whoami)@$(hostname)'
   # Expect: ok=synappssbx-pace@app-server-02
   ```

3. **Set CI/CD variables** *(pace → Settings → CI/CD → Variables)* — values from ai01:
   ```bash
   sudo base64 -w 0 /home/gitlab-runner/.ssh/id_ed25519_pace_sbx   # → SSH_KEY_SBX
   ssh-keyscan -H ai-server-01 app-server-02                              # → SSH_KNOWN_HOSTS
   ```
   | Key | Masked | Protected |
   |-----|--------|-----------|
   | `SSH_KEY_SBX` (base64 key) | ✓ | ✗ (`develop` isn't protected) |
   | `SSH_KNOWN_HOSTS` (keyscan) | ✗ | ✗ |

4. **Confirm the shell runner can build** *(on ai01)* — `deploy.sh` builds the SPA there:
   ```bash
   sudo -u gitlab-runner bash -lc 'command -v node npm uv rsync ssh'   # all must resolve
   ```

5. **Trigger** — pace → Build → Pipelines → the latest `develop` pipeline →
   **Retry** the `deploy-sbx` job (or push to `develop`). It SSHes to lx02, updates
   the checkout to `develop`, `uv sync`, builds + rsyncs the SPA, restarts the
   service. (Deploys do **not** touch the DB — see **Database setup** below for the
   one-time schema step.) Verify:
   ```bash
   sudo -u synappssbx-pace git -C /opt/synveon/pace-sbx rev-parse HEAD   # == origin/develop
   systemctl is-active pace-api@sbx && curl -s localhost:8014/health
   ```
   Then open **https://apps.example.com/pace-sbx/**.

> **uat/prod:** same pattern with `id_ed25519_pace_<env>` authorized on
> `synapps-pace`, and `SSH_KEY_UAT`/`SSH_KEY_PROD` set **Protected** after
> marking `uat`/`main` protected branches.

## Deploy / redeploy (after provisioning)

**Normally you don't run this by hand — CI does it** (see below). `deploy.sh` exists
for the workstation fallback and is what CI invokes.

> ⚠️ **Run it from a *separate* machine, never on the target host.** `deploy.sh`
> does `ssh ${SERVICE_USER}@${TARGET_HOST}` for every step, and the service user is
> a passwordless `--system` account — so running it **on `app-server-02`** just
> loopback-SSHes into a user you can't password-auth as, and fails with
> "Permission denied." It must run from a box with **key-based** SSH to
> `${SERVICE_USER}@app-server-02`: the **CI runner** (uses `SSH_KEY_SBX`) or your
> **workstation** (authorize your pubkey on the service user first). It also needs
> `node` + `uv` to build the SPA locally.

```bash
# from your WSL workstation (one-time: append your pubkey to the service user's
# ~/.ssh/authorized_keys on lx02), repo root, on the branch that feeds the env:
./_deploy/scripts/deploy.sh sbx
```

This builds the SPA (base `/pace-sbx/`), updates the host checkout to
`develop`, rsyncs `dist/` into `DIST_ROOT/SPA_SEGMENT/`
(= `/var/www/html/pace-sbx/`), and restarts `pace-api@sbx`. It does **not**
touch the database (see **Database setup** below).

**Already logged into `app-server-02` and just need to finish/redeploy?** Don't use
`deploy.sh` there — run its steps locally instead (as the service user, no SSH):

```bash
sudo rsync -a --delete \
  /opt/synveon/pace-sbx/frontend/dist/ /var/www/html/pace-sbx/   # build dist first
sudo chown -R synappssbx-pace: /var/www/html/pace-sbx
sudo systemctl restart pace-api@sbx
```

## Database setup (one-time per env)

Deploys no longer run migrations, and **the app does not create database objects**:
it connects as a low-privilege login role (`app_admin`) with no DDL rights. So the
schema, tables, and grants are a **DBA/owner** step, done **once per environment**
with an admin/owner account — not as the service user, and not on deploy.

1. **DBA applies the DDL + grants** (`backend/sql/postgres/*.sql`) with an owner/admin DSN,
   from the project root. Set the URL in your shell with `read -s`, which keeps it off the
   screen and out of shell history:

   ```bash
   read -rsp 'Admin Postgres URL: ' ADMIN_POSTGRES_URL && echo && export ADMIN_POSTGRES_URL
   ```

   Paste a plain `postgresql://` URL (strip the `+asyncpg` that the app's `POSTGRES_URL`
   carries), e.g. `postgresql://<owner_user>@app-server-01:5432/synveon_dev`. Leave the
   password out and let `psql` use `~/.pgpass` or prompt; putting it in the URL works but is
   not recommended. Check you're connected as the user you expect (read-only):

   ```bash
   psql "$ADMIN_POSTGRES_URL" -Atc 'select current_user, current_database()'
   ```

   If it prints `<owner_user>|synveon_dev`, apply every script in filename order
   (`001_schema.sql` first, `999_grants.sql` — USAGE + CRUD for `app_admin` — last),
   stopping at the first error:

   ```bash
   psql "$ADMIN_POSTGRES_URL" -v ON_ERROR_STOP=1 $(printf -- '-f %s ' backend/sql/postgres/[0-9][0-9][0-9]_*.sql)
   ```

   Then clear the variable:

   ```bash
   unset ADMIN_POSTGRES_URL
   ```

   All DDL is `... IF NOT EXISTS`, so re-applying is safe. `999_grants.sql` sets
   `ALTER DEFAULT PRIVILEGES`, so tables the owner adds later are auto-granted.

2. **Verify + seed from the app side**, as the service user so it reads the host
   secret file. `setup_db.py` creates nothing — it checks the DBA's work is in
   place (schema + tables exist, app role has SELECT + CRUD) and fails loudly if not:

   ```bash
   sudo -u synappssbx-pace env HOME=/opt/synveon/pace-sbx bash -c '
     set -a; . /etc/pace-sbx.env; set +a
     cd /opt/synveon/pace-sbx/backend \
       && uv run python -m scripts.postgres.setup_db \
       && if [ -f scripts/postgres/seed.py ]; then uv run python -m scripts.postgres.seed; fi'
   ```

**When you add a new entity**, the DBA applies its new `sql/postgres/NNN_*.sql` and re-runs
`999_grants.sql` on each env — deploys won't do this for you; then re-run the
verify step. **Altering an existing table** (new/changed columns) is likewise a
manual SQL operation for the owner against the env DB.

## Deploying via CI

The CI pipeline ([.gitlab-ci.yml](../.gitlab-ci.yml)) lints, tests, builds, and
**deploys** by delegating to `_deploy/scripts/deploy.sh <env>` on a `shell` runner:

| Branch | Deploys to | Trigger |
|--------|-----------|---------|
| `develop` | sbx | automatic on push |
| `uat` | uat | automatic on push |
| `main` | prod | **manual** button (uat also available as a manual hotfix) |

So day-to-day you only push — merge to `develop`/`uat` ships SBX/UAT; PROD is the
manual `deploy-prod` button on `main`. The **`/syn-promote-feature <sbx|uat|prod>`** skill does
that merge-and-push for you (and records the environment on the feature's backlog entry) —
see [`_workitems/README.md`](../_workitems/README.md), Stage 4. Enabling the shared ai01 runners for this
project, the per-env SSH keys, and the GitLab variables are the one-time setup in
**[gitlab-setup.md](gitlab-setup.md)**. CI does **not** re-render Caddy/systemd
config — template changes (ports, base paths, the `@sbx` drop-in) are applied on
the host by hand.
