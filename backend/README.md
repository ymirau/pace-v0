# pace-v0 — backend

FastAPI service. Async SQLAlchemy 2.0 over the shared Synveon Postgres, Azure/Entra JWT
auth, plain SQL setup scripts. Managed with [uv](https://docs.astral.sh/uv/). Tables
are isolated in a dedicated **`pace`** Postgres schema.

> Ships one example entity (**Items**). See [CLAUDE.md](CLAUDE.md) for the
> step-by-step recipe to add your own.

## Stack

- Python 3.12, FastAPI, Uvicorn
- SQLAlchemy 2.0 (async) + asyncpg
- Plain SQL DDL scripts (`sql/postgres/`), applied by a DBA/owner; `scripts/postgres/setup_db.py` is an app-role readiness check
- PyJWT for Azure/Entra token validation
- pydantic-settings for config; pytest + pytest-asyncio for tests

## Layout

```
backend/
├── main.py                       # app factory, lifespan, router wiring, CORS
├── app/
│   ├── core/
│   │   ├── config.py             # Settings (env-driven) + get_settings()
│   │   └── security.py           # Azure JWT validation, get_current_user
│   ├── routers/
│   │   ├── health.py             # GET /health (unauthenticated)
│   │   └── items.py              # /api/items (list + create), auth-guarded
│   ├── schemas/item.py           # Pydantic request/response models
│   └── sources/postgres/
│       ├── session.py            # async engine + get_session dependency
│       └── models/               # SQLAlchemy ORM models (base, item)
├── sql/                          # SQL grouped by source
│   ├── sqlserver/                # *.sql queries for the SQL Server reports
│   └── postgres/                 # NNN_*.sql DDL (schema + tables) + 999_grants.sql — applied by a DBA/owner
├── scripts/postgres/             # setup_db.py (readiness check) + seed.py
└── tests/                        # pytest (health, items, auth guard)
```

All application routes are mounted under **`/api`** (e.g. `/api/items`) because the
platform's Caddy strips only the env path prefix before proxying. `/health` stays
at the root for direct liveness checks. See [../_deploy/README.md](../_deploy/README.md).

## Setup

```bash
cd backend
uv sync                      # create .venv and install deps
cp .env.example .env         # then fill in the values below
```

`.env` is **local development only** (gitignored; never put one on a server). Deployed
envs read `_deploy/envs/<slug>-<env>.env` and `/etc/<slug>-<env>.env` instead.

| Var | Purpose |
|-----|---------|
| `POSTGRES_URL` | `postgresql+asyncpg://user:pw@host:5432/db` (shared Synveon instance; pytest reuses it and rolls back) |
| `AUTH_DISABLED` | **local dev only** — skip token validation; `true` in `.env.example`. A deployed env (one with `ENV_NAME` set) refuses to start with it on |
| `AZURE_TENANT_ID`, `AZURE_API_AUDIENCE` | optional — default to the shared Synveon Entra registration (`app/core/config.py`) |
| `AZURE_ISSUER` | optional issuer override (set for v1 tokens) |
| `CORS_ALLOW_ORIGINS` | deployed envs only — comma-separated allowed origins, set in `_deploy/envs/` |
| `SQLSERVER_HOST`, `_PORT`, `_DATABASE`, `_USER`, `_PASSWORD` | optional — SQL Server for `/api/reports/*` (503 when unset); needs ODBC Driver 18. See [CLAUDE.md](CLAUDE.md#optional-source-sql-server-readwrite) |

The app isolates its tables in a dedicated **`pace`** Postgres schema.

## Run

The schema, tables, and grants must already exist (see **Database setup** below —
a DBA/owner step). Then, as the app role:

```bash
uv run python -m scripts.postgres.setup_db   # verify the DB is ready (does NOT create anything)
uv run uvicorn main:app --reload --port 8000
```

- API docs: http://localhost:8000/docs
- Health: http://localhost:8000/health

## Database setup

There are no migrations. The schema and tables are defined as plain SQL in
[sql/postgres/](sql/postgres/) — **hand-numbered, sequential** files (`001_schema.sql`,
`002_items.sql`, …), plus [999_grants.sql](sql/postgres/999_grants.sql).

**Local Postgres (your own machine):** one command does all of it —
`/syn-init-local-postgres-db` in Claude Code (from the Synveon webapp toolkit). It connects as
you over the local Unix socket (no password, never TCP: peer auth, on Linux and macOS alike) to `synveon_loc`
(or the local database `.env`'s `POSTGRES_URL` names), applies every `NNN_*.sql` and
`999_grants.sql`, runs the readiness check and the seed, and fills in `.env`'s
`POSTGRES_URL` when it's still the placeholder. Safe to re-run (e.g. after adding an
entity); when the schema already exists it shows its tables and offers to drop and
rebuild it. With no local Postgres it says so and changes nothing. `/syn-init-webapp`
runs the same step for you.
The app itself runs as the limited `app_admin` role, as on sbx/uat/prod:
`POSTGRES_URL=postgresql+asyncpg://app_admin@localhost:5432/synveon_loc`, with no
password in the URL, since the toolkit's machine setup (WSL or macOS) saves it in `~/.pgpass`, which asyncpg
reads. `/syn-init-local-postgres-db` writes that URL when the `~/.pgpass` entry is there
and works; otherwise it writes your own socket URL. The `app_admin` login is over TCP, so
it needs a cluster that listens on a port (not a socket-only one).
Everything below is for shared/deployed databases.

**The app role cannot create database objects.** It connects as a low-privilege
login role (`app_admin`) with no DDL rights. So the DDL and grants are a
**DBA/owner** step, run **once per environment** with an admin/owner account —
not by the app and not on deploy:

```bash
# As the schema owner / DBA (psql needs a plain postgresql:// URL — drop the
# "+asyncpg" that POSTGRES_URL carries). ADMIN_POSTGRES_URL is the owner's DSN.
psql "$ADMIN_POSTGRES_URL" -f sql/postgres/001_schema.sql     # CREATE SCHEMA pace
psql "$ADMIN_POSTGRES_URL" -f sql/postgres/002_items.sql      # + every other sql/postgres/NNN_*.sql, in order
psql "$ADMIN_POSTGRES_URL" -f sql/postgres/999_grants.sql     # grant the app role USAGE + CRUD
```

Every DDL statement is `... IF NOT EXISTS`, so re-applying is a no-op.
`999_grants.sql` also sets `ALTER DEFAULT PRIVILEGES`, so tables the owner adds
later are auto-granted — but re-run it after adding a table if you want the grant
applied immediately.

Once that's done, verify from the app side and seed (as the app role):

```bash
uv run python -m scripts.postgres.setup_db   # readiness check: schema + tables exist, app role has SELECT + CRUD
```

`setup_db.py` creates nothing — it connects as `POSTGRES_URL` and fails with
actionable guidance if the DBA's DDL or grants are missing, so a half-provisioned
database is caught before the first request.

**Adding an entity** means dropping a new `sql/postgres/NNN_create_<table>.sql` file and
having the DBA apply it (then re-run `999_grants.sql`). **Altering an existing
table** is likewise a manual SQL operation for the owner — write and run the
`ALTER` against each environment's database.

> **Local dev** with a Postgres you own: you *are* the DBA — apply the DDL above
> as your superuser. The grants target the `app_admin` role; if you don't have a
> separate low-privilege role locally and connect as the owner, you can skip
> `999_grants.sql` (the owner already has full access and the readiness check
> passes).

## Auth

`get_current_user` ([app/core/security.py](app/core/security.py)) validates the
Azure/Entra bearer JWT (signature via JWKS, issuer, audience) and is applied as a
router-level dependency. Any authenticated user has full access (no RBAC yet);
claims (`sub`, `preferred_username`) are returned for future auditing. Tests
override this dependency, so no real tokens are needed.

## Tests

```bash
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
```

Tests run against `POSTGRES_URL` inside a transaction that rolls back, so writes
never persist. In CI they run against a throwaway Postgres service that lives only
for the job (see `.github/workflows/ci.yml`); locally, point `POSTGRES_URL` at a disposable
dev database.

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | no | Liveness probe |
| GET | `/api/items` | yes | List items |
| POST | `/api/items` | yes | Create an item |
