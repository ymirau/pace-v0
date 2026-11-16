# pace-v0

Template for a Synveon internal full-stack web app: **FastAPI + async SQLAlchemy +
Postgres** backend and a **React 19 SPA** frontend, wired for **Azure/Entra (MSAL)
auth** and deployment behind **Azure App Proxy + Caddy** with per-env path routing.

> **This is a scaffold.** It ships one working end-to-end vertical slice — an
> example **Items** entity (React → auth'd request → FastAPI → Postgres) — plus
> health, auth, migrations, tests, CI, and per-env deploy config. Rename it,
> replace the example entity with your domain, and build out from there. The
> [backend](backend/CLAUDE.md) and [frontend](frontend/CLAUDE.md) `CLAUDE.md` files give
> the recipe for a new vertical slice.

## Components

| Component | Description | README |
|-----------|-------------|--------|
| **Backend** | FastAPI + async SQLAlchemy + Postgres, Azure/Entra JWT auth | [backend/README.md](backend/README.md) |
| **Frontend** | React 19 SPA (Vite, Tailwind, React Router, TanStack Query, MSAL) | [frontend/README.md](frontend/README.md) |
| **Deploy** | Path-based routing behind Azure App Proxy + Caddy; per-env config | [_deploy/README.md](_deploy/README.md) |
| **GitLab repo** | Create the project, add `origin`, push `develop`/`uat`/`main` (or run `/syn-init-github` for a GitHub repo) | [_deploy/gitlab-repo-setup.md](_deploy/gitlab-repo-setup.md) |
| **Product workflow** | File-based backlog → planning → PRD → implement → shipped pipeline | [_workitems/README.md](_workitems/README.md) |

## Architecture

```
Browser ──HTTPS──▶ Azure App Proxy ──▶ Caddy (path routing)
                                          ├─ /pace-<env>/api/*  ▶ FastAPI (uvicorn)
                                          └─ /pace-<env>/*       ▶ static SPA (Vite build)
                                                                    FastAPI ▶ Postgres (pace schema)
```

Environments are distinguished by **URL path**, not hostname: `/pace-sbx`,
`/pace-uat`, `/pace` (prod). See [_deploy/README.md](_deploy/README.md).

## Repo layout

```
pace-v0/
├── backend/          # FastAPI service (uv, SQLAlchemy)            → backend/README.md
├── frontend/         # React 19 SPA (Vite)                         → frontend/README.md
├── _deploy/          # deploy env files + deployment guide         → _deploy/README.md
├── _workitems/       # product workflow: backlog, planning, PRDs   → _workitems/README.md
├── .githooks/        # pre-commit branch guard; pre-push merge-only check + mirror of _workitems/features/ to synnexus; enable-hooks.sh (run by npm install)
├── CLAUDE.md         # conventions & extension recipes for Claude Code
└── .gitlab-ci.yml    # lint / test / build pipeline
```

## Quick start (local)

Two terminals — backend first, then frontend:

```bash
# 1) Backend (http://localhost:8000)
cd backend
uv sync && cp -n .env.example .env     # fill in POSTGRES_URL (AUTH_DISABLED=true is already on)
# Create schema + tables once, as the DB OWNER (the app role can't run DDL).
# For a local DB you own, you're the owner; psql needs a plain postgresql:// URL:
psql "<owner postgresql:// URL>" -f sql/postgres/001_schema.sql -f sql/postgres/002_items.sql \
  -f sql/postgres/003_support_requests.sql -f sql/postgres/004_user_roles.sql   # 004 seeds you as the first admin
uv run python -m scripts.postgres.setup_db && uv run python -m scripts.postgres.seed   # setup_db verifies readiness; it creates nothing
uv run uvicorn main:app --reload --port 8000

# 2) Frontend (http://localhost:5173)
cd frontend
npm ci && npm run dev
```

Open http://localhost:5173 → **Items**. Over HTTP, MSAL is bypassed (the backend
`.env` has `AUTH_DISABLED=true` to match), so the full slice works
locally without an Azure login. Details in each component's README.

## Config files

Every setting lives in one of these files. Each file's header repeats what it is.

| File | Where it's used | Committed? | Loaded by | What goes in it |
|------|-----------------|------------|-----------|-----------------|
| `backend/.env.example` | your machine | yes | nobody: it's the template for `backend/.env` | every backend setting, with placeholders |
| `backend/.env` | **your machine only** | **no** (git-ignored) | the backend (`uvicorn`, `pytest`) | your local values: `POSTGRES_URL`, `AUTH_DISABLED`, any data source you use |
| `_deploy/envs/pace-<env>.env` | sbx / uat / prod servers | yes | systemd (`EnvironmentFile`), `install.sh`, `deploy.sh` | settings that aren't secret: paths, ports, base path, Postgres host/db/user, CORS, data-source hosts |
| `_deploy/envs/pace.secrets.env.example` | sbx / uat / prod servers | yes (placeholders only) | `install.sh`, which renders it to `/etc/pace-<env>.env` | the list of secrets each env needs |
| `/etc/pace-<env>.env` | **on the server only** | **no** | systemd (`EnvironmentFile`) | the real secrets: the Postgres password, data-source passwords and keys |
| `.githooks/synnexus.env.example` | your machine | yes | nobody: the WSL setup and `/syn-sync-workitems` copy it to `~/.config/synnexus.env` (the macOS setup skips it until Nexus is available) | the synnexus endpoint, bucket and access key (the one place they're set); you add the secret key |

- **`backend/.env` is local only. Never put one on a server.** The service runs from
  `backend/`, so a stray `.env` there would be read too (below systemd's values).
- **Which value wins.** Locally, a variable exported in your shell beats `backend/.env`.
  On a server, systemd loads the settings file, then `/etc/pace-<env>.env`, so a key set
  in both takes the secrets file's value. CI sets its own variables in `.gitlab-ci.yml`.
- **Not in any env file:** the shared Entra IDs. They're defaults in
  `backend/app/core/config.py` (overridable by env var) and constants in
  `frontend/src/authConfig.ts`. The frontend has no env files.

## Starting a new project from this template

Use the `/syn-init-webapp` skill (copies this template, renames the project +
`pace` slug, runs setup), or do it by hand:

1. Copy this directory to your new project location.
2. Replace `pace-v0` (project name) and `pace` (slug → Postgres schema,
   deploy base path, service user, env-file names) throughout.
3. `cd backend && uv sync`; `cd frontend && npm ci`.
4. Replace the example **Items** entity with your domain (or add new ones by the
   recipes in `backend/CLAUDE.md` and `frontend/CLAUDE.md`), and update this README.

## Tech stack

React 19 · Vite · TailwindCSS · React Router · TanStack Query · FastAPI ·
Python 3.12 · uv · PostgreSQL · Azure/Entra (MSAL) · Azure App Proxy · GitLab CI/CD
