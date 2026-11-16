# CLAUDE.md — backend

FastAPI + async SQLAlchemy 2.0 + asyncpg, managed with `uv`. Tables are
isolated in the **`pace`** Postgres schema. See [README.md](README.md) for
setup/env details; this file is how to extend the service.

## Module map

```
main.py                          app factory, lifespan (engine init/dispose), CORS, router wiring
app/core/config.py               Settings (pydantic-settings, env-driven) + get_settings()
app/core/security.py             Azure JWT validation; get_current_user / CurrentUser; principal_identity / principal_email
app/core/roles.py                roles: resolve_role, CurrentRole, require_role("admin"), normalize_email
app/routers/<entity>.py          APIRouter per entity, prefix="/<entity>", auth dependency
app/schemas/<entity>.py          Pydantic <Entity>Create / <Entity>Read models
app/sources/postgres/
  session.py                     async engine + get_session dependency (SessionDep)
  models/base.py                 DeclarativeBase
  models/<entity>.py             SQLAlchemy ORM model
app/sources/sqlserver/
  session.py                     lazy async SQL Server engine + get_sqlserver_session (optional read/write source)
app/services/reports.py          SQL Server query → server info (example read; docstring shows a write)
app/routers/reports.py           /reports/* endpoints (SQL Server-backed; 503 if unconfigured)
app/services/mailer.py           SMTP mailer: OutgoingEmail, get_mailer, MAIL_ENABLED / MAIL_REDIRECT_TO
app/services/uploads.py          image upload policy (types, size cap) for the support form's photos
app/routers/support.py           /support: the Support page's form → email to SUPPORT_EMAIL (+ support_requests log)
app/routers/me.py                /me: the caller's email, name and real role (for the SPA)
app/routers/user_roles.py        /user-roles: admins list/grant/change/revoke roles (lockout guards)
app/routers/sources.py           /sources/status: which optional sources are configured (settings only, for the Home page)
sql/postgres/NNN_*.sql                    hand-numbered DDL (001_schema, 002_items, …) + 999_grants.sql — applied by a DBA/owner
sql/sqlserver/*.sql                       queries for the SQL Server reports (loaded by services/reports.py)
scripts/postgres/setup_db.py              app-role readiness check (verifies the DBA's DDL + grants; creates nothing)
tests/                           pytest; conftest overrides session + auth
```

## Optional source: SQL Server (read/write)

For data that lives in an existing SQL Server database (e.g. on `DB-SERVER-01`).
`app/sources/sqlserver/session.py` builds an async SQLAlchemy engine
(`mssql+aioodbc`, on Microsoft's ODBC Driver 18) **lazily** on the first
`get_sqlserver_session()` call, disposed in the lifespan. With `SQLSERVER_HOST` unset
it raises `SqlServerNotConfiguredError`; if `pyodbc` can't be imported (no unixODBC)
or the driver isn't registered, `SqlServerDriverUnavailableError`. `pyodbc` is never
imported at module level, so CI and machines without the driver still import and
test the app. The worked example is the Samples page's Reports tab: `services/reports.py` runs
`sql/sqlserver/server_info.sql` with `text()` on the session, and
`routers/reports.py` takes the session as `SqlServerSessionDep`, whose dependency maps
the two setup errors to 503 (they're raised before the handler runs); the handler maps
query/connection failures and timeouts to 502.

- **Read:** put the query in `sql/sqlserver/<name>.sql`, run it in a service with
  `await session.execute(text(sql), params)`, shape `result.mappings()` into a schema.
- **Write:** same session; bind every value (`:name` params, never f-strings), then
  `await session.commit()`. An exception before the commit rolls back. The app's login
  should be least-privilege; we own no SQL Server schema, so there are no DDL scripts.
- **Config:** `SQLSERVER_HOST/PORT/DATABASE/USER/PASSWORD` in `config.py` +
  `.env.example`; `Encrypt` and `TrustServerCertificate` default to `yes`, login
  timeout 10 s, query timeout 60 s (all overridable). Local dev already has the
  driver from the toolkit's machine setup (`scripts/setup-wsl-dev.sh` on WSL,
  `scripts/setup-mac-dev.sh` on macOS, via Homebrew's `msodbcsql18`); deployed hosts need it too
  (`_deploy/scripts/install.sh` checks when `SQLSERVER_HOST` is set).


## Email and the Support page (always included)

Plain SMTP to Office 365's connector for example.com (`app/services/mailer.py`):
no login, so nothing is secret and every `MAIL_*`
setting lives in the committed env files. It's on in the deployed env files and off
locally: `MAIL_ENABLED=false` sends nothing and logs what it would have sent.
`MAIL_REDIRECT_TO` sends every message to one inbox instead, naming the intended
recipient (set on sbx/uat). The worked example is the Support page's
`POST /api/support` (`routers/support.py`): it emails
`SUPPORT_EMAIL` inline (502 when the relay refuses, so the page can offer its
`mailto:` fallback), with up to 3 photos checked by `services/uploads.py`, and logs
each send best-effort in `pace.support_requests` (`sql/postgres/003_support_requests.sql`).

- **Send a notification:** build an `OutgoingEmail` (plain text + HTML, every value
  `html.escape`d), take `mailer: Annotated[Mailer, Depends(get_mailer)]` and a
  `BackgroundTasks`, and `background_tasks.add_task(mailer.send, message)` after the
  write commits. `smtplib` blocks, so it must never run on the request path, and a
  relay failure must not fail the user's save. The recipient's address comes from
  `principal_email()` or your own data, never a raw token claim.
- **Test it:** override `get_mailer` with a fake (see `tests/test_support.py`); never
  point a test at the relay.

## Roles (always included)

`app/core/roles.py`. `pace.user_roles`
(`sql/postgres/004_user_roles.sql`, which seeds the bootstrap admin) holds a row per
**email**, lowercased; roles are `admin` and `user`. A signed-in caller with **no row is a
`user`**, so a missing row never locks anyone out. A token without an email, an unknown
stored value, and a database error (e.g. 004 not applied yet) all resolve to `user`,
logged; `AUTH_DISABLED` (local dev) makes the dev user an `admin`. `display_name` is a
display copy of the directory name, set when an admin adds someone with the SPA's people
picker (Admin → Users); it's never used for lookups.

- **Gate a router or a route:** `dependencies=[Depends(require_role("admin"))]` → 403
  `"You need the admin role for this."` for anyone else. It also checks the token, so it
  replaces `get_current_user` on that router (`test_auth_guard.py` follows nested
  dependencies). In a handler that only needs to *know* the role, take `role: CurrentRole`.
- **The SPA asks `GET /api/me`** and hides admin-only UI from it, but that is UX only:
  every admin-only endpoint must carry `require_role("admin")` itself.
- **Managing roles:** `/api/user-roles` (admins only) refuses a change to the caller's own
  row and removing or demoting the last admin (both 409), so an env never ends up with no
  admin. The dev user has no row, so it never counts as "another admin".
- **Test it:** see `tests/test_roles.py` — override `get_current_user` with a token whose
  `preferred_username` is the email, and set rows inside the test's transaction.

## Recipe: add an entity (vertical slice)

1. **Model** — `app/sources/postgres/models/<entity>.py`. Subclass `Base`, set
   `__tablename__` and `__table_args__ = {"schema": "pace"}`. Use
   `Mapped[...] / mapped_column(...)`. FKs reference `pace.<table>.<col>`.
2. **SQL setup script** — `sql/postgres/NNN_create_<table>.sql`. **Numbering is manual and
   sequential** (`001_schema.sql`, `002_items.sql`, …). Use
   `CREATE TABLE IF NOT EXISTS pace.<table> (...)`; write FK columns as
   `... REFERENCES pace.<parent>(id) ON DELETE CASCADE` and add a
   `CREATE INDEX IF NOT EXISTS ix_<table>_<col> ON pace.<table> (<col>)` per FK.
   Do **not** re-create the schema (`001_schema.sql` owns
   `CREATE SCHEMA IF NOT EXISTS pace`). **The app role can't run DDL** — a
   DBA/owner applies the new file (`psql -f`) and re-runs `sql/postgres/999_grants.sql`;
   then verify from the app side with `uv run python -m scripts.postgres.setup_db`.
   On your **local** Postgres, `/syn-init-local-postgres-db` does all of that in one
   re-runnable step.
3. **Schemas** — `app/schemas/<entity>.py`. `<Entity>Create` for the create body
   (validate with `Field(...)`); `<Entity>Update` with **all fields optional** for
   PATCH; `<Entity>Read` for responses with
   `model_config = ConfigDict(from_attributes=True)`.
4. **Router** — `app/routers/<entity>.py`, full CRUD (see `routers/items.py`):
   ```python
   router = APIRouter(prefix="/<entity>", tags=["<entity>"],
                      dependencies=[Depends(get_current_user)])
   SessionDep = Annotated[AsyncSession, Depends(get_session)]
   ```
   - `list` (GET ""), `create` (POST "", 201) — take `session: SessionDep`, set
     `response_model=`, return the ORM object(s).
   - `update` (PATCH "/{id}") — load via an `_get_or_404` helper (404 if missing),
     apply `payload.model_dump(exclude_unset=True)`, commit, refresh, return it.
   - `delete` (DELETE "/{id}", 204) — `_get_or_404`, `session.delete`, commit,
     `return Response(status_code=204)`.
5. **Wire it** — in `main.py`, import the router and
   `app.include_router(<entity>.router, prefix="/api")`. **The `/api` prefix is
   added here, not in the router** (the router prefix is just `/<entity>`).
6. **Tests** — `tests/test_<entity>.py`. Use the `client` fixture (auth + session
   already overridden). Add a `seed_<entity>` fixture in `tests/fixtures/postgres.py`
   if you need pre-existing rows. Cover: list, create (201), validation (422),
   update (PATCH), delete (204 then 404). **No auth test per router**:
   `tests/test_auth_guard.py` already fails if any `/api` route lacks
   `get_current_user`, as long as the router sets it at router level.

## Conventions that matter

- **Session dependency**: always `SessionDep = Annotated[AsyncSession, Depends(get_session)]`.
  The engine is created in `main.py`'s lifespan; never create engines in handlers.
- **Auth**: apply `dependencies=[Depends(get_current_user)]` at the router level.
  Use `CurrentUser` (from `app.core.security`) as a param only when a handler needs
  the caller's claims, and read them through `principal_identity(user)` (→
  `(object_id, display_name)`, for audit columns) and `principal_email(user)` — never
  pick `oid`/`sub`/`name` yourself. Any valid token can call a route unless it also
  carries `require_role("admin")` (see Roles above).
- **Config**: add new settings to `app/core/config.py` as `Field(..., alias="ENV_VAR")`
  and document them in `.env.example` + `README.md`.
- **Tests run in a rolled-back transaction** (`tests/fixtures/postgres.py`) against
  `POSTGRES_URL`, so committed writes don't persist. CI points that URL at a
  throwaway Postgres service (see `.github/workflows/ci.yml`); locally use a disposable DB.

## Commands

```bash
uv sync                                              # install deps
uv run uvicorn main:app --reload --port 8000         # run (docs at /docs)
uv run python -m scripts.postgres.setup_db                    # readiness check (DBA applies sql/postgres/ DDL + grants first; creates nothing)
uv run ruff check . && uv run ruff format --check .   # lint + format check
uv run pytest -q                                     # tests (needs a reachable Postgres)
```
