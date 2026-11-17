# CLAUDE.md — pace-v0

Full-stack monorepo: FastAPI backend + React 19 SPA, deployed behind Azure App
Proxy + Caddy with **per-env path routing**. See [README.md](README.md) for the
human-facing overview; this file is the operational guide for extending the code.

## Layout & where to work

| Path | What | Detailed guide |
|------|------|----------------|
| `backend/` | FastAPI service (uv, async SQLAlchemy 2.0, Postgres) | [backend/CLAUDE.md](backend/CLAUDE.md) |
| `frontend/` | React 19 SPA (Vite, Tailwind, React Router, TanStack Query, MSAL) | [frontend/CLAUDE.md](frontend/CLAUDE.md) |
| `_deploy/` | Per-env config files + deployment guide | [_deploy/README.md](_deploy/README.md) |
| `_workitems/` | Product workflow — backlog, planning, PRDs, the Ralph runner | [_workitems/README.md](_workitems/README.md) |
| `.github/workflows/ci.yml` | lint → test → build on every push and PR (path-filtered per component) | |

## Cross-cutting invariants — do not break these

1. **All backend routes mount under `/api`** (`main.py` adds the prefix). Caddy
   strips only the env path prefix before proxying, so the service must answer at
   `/api/*`. `/health` is the one exception (root, unauthenticated).
2. **Postgres tables live in the `pace` schema**, not `public`. Every model
   sets `__table_args__ = {"schema": "pace"}`; every `sql/postgres/*.sql` setup script
   qualifies tables as `pace.<table>`; FKs are written `pace.<table>(<col>)`.
3. **Environments differ by URL path, not hostname** (`/pace-sbx`,
   `/pace-uat`, `/pace`). The SPA bakes its base path in at build time
   and derives the API base from it — there are no per-env API env vars. (MSAL login
   uses the shared, path-independent `/auth-callback/` redirect, not a per-env URI;
   see frontend/CLAUDE.md.)
4. **Auth bypass is HTTP-only.** The SPA bypasses MSAL when not served over HTTPS;
   the backend skips token validation when `AUTH_DISABLED=true`. Both are local-dev
   conveniences and must never be enabled in sbx/uat/prod.
5. **Every `/api` route requires a token, checked in one place.**
   `backend/tests/test_auth_guard.py` walks the route table and fails on any `/api`
   route without `get_current_user`, so routers don't need their own auth test. Code
   that records who acted uses `principal_identity()` and reads an email with
   `principal_email()` (both in `app/core/security.py`), never raw token claims.
6. **State is per visitor; the log is not.** Every `/api/chat` route is scoped to the
   caller's `X-Pace-Visitor` header (`app/core/visitor.py`), so each browser gets its own
   copy of the seed and its own conversation — one reviewer's cleanup must never change
   what the next reviewer is shown, or their ratings stop being comparable. `chat_events`
   and `chat_ratings` stay global: the evidence is the deliverable and is read across
   everybody. A new state read or write that forgets the visitor argument silently
   reintroduces the shared world, so `tests/test_visitors.py` pins both halves.
   The id is client-supplied and is **not** an identity, not a credential and not a
   secret; `solo` is reserved for a caller that sends none and maps to the pre-visitor
   `'current'` row.
7. **Two codes, and they are not interchangeable.** `PACE_ACCESS_CODE` gates `/api/chat`
   and `/api/my-log` (a bill guard, shared with every reviewer; `my-log` is safe there
   because it only ever returns the caller's own sessions — scope comes from the request's
   visitor header, never a parameter, and a session id that isn't yours answers 404).
   `PACE_VIEWER_CODE` gates the unscoped `/api/log` and the `/viewer` page. They are separate because the log now holds every reviewer's
   transcript and the notes written about the agent's replies, so the code handed out
   with the link must not read it. **Both gates are open when their variable is empty**,
   which is right locally and means a deployed env that sets one and not the other has
   published what the other protects.
8. **Sign-in recovery depends on msal-browser 4.x internals.**
   `frontend/src/authRecovery.ts` clears MSAL's `msal.`-prefixed sessionStorage keys and
   expires its `msal.cache.encryption` cookie. On a major `@azure/msal-browser` upgrade,
   re-check those names before shipping, or "Sign in again" may silently stop working.

## Branches — never commit on `main`, `uat` or `develop`

They only receive merges: `develop` → sbx, `uat` → uat, `main` → prod. Commit on a
`feature/*`, `fix/*` or `chore/*` branch and merge it up (`/syn-promote-feature`). The
`.githooks/pre-commit` guard refuses a commit while one of them is checked out; if it
fires, `git switch -c feature/<name>` (your changes come along) and commit there. Since git
skips `pre-commit` for revert, cherry-pick and rebase, `.githooks/pre-push` also refuses to
push `uat` or `main` if they gained a commit that isn't a merge. Don't reach for
`--no-verify` to get past either. The hooks switch themselves on per clone
(`.githooks/enable-hooks.sh`, run by `npm install` in `frontend/` and by the toolkit
skills); never ask a developer to run `git config core.hooksPath`. `_workitems/` changes
go through the workflow skills, which land them on `develop` via a chore branch and a
fast-forward.

## Run locally (two terminals)

Which env file holds which setting (local `backend/.env` vs the deployed settings and
secrets files): [README.md → Config files](README.md#config-files).

```bash
# Backend — http://localhost:8000
cd backend && uv sync && cp -n .env.example .env   # local only: has AUTH_DISABLED=true
# Local Postgres: run /syn-init-local-postgres-db in Claude Code (DDL + grants +
# readiness check + seed in one go, as you over the local socket; fills in
# POSTGRES_URL; safe to re-run, offers a reset when the schema exists)
uv run uvicorn main:app --reload --port 8000

# Frontend — http://localhost:5173 (Vite proxies /api to :8000)
cd frontend && npm ci && npm run dev
```

## Before you call a change done

```bash
cd backend  && uv run ruff check . && uv run ruff format --check . && uv run pytest -q
cd frontend && npm run lint && npm run build
```

Adding a feature usually means a **vertical slice on both sides**: a backend
entity (model → SQL → schema → router → test) and a frontend page (api hooks
→ page → route + nav). The per-side CLAUDE.md files give the exact recipe.
