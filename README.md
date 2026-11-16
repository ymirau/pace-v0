# pace-v0 — the Pace chat UI

A **proactive project-management agent** for one founder, as a single-screen web app.
The agent speaks first, brings a plan, and the founder says yes.

Built from the Synveon full-stack template (FastAPI + React 19 SPA), with the
template's worked examples stripped out and replaced by one thing: the conversation.

> **This is spike work, not a product.** It exists to answer one question — is a pushy
> agent **magic** or **annoying**? The thesis, scenario script and close-out live in the
> terminal spike repo, [`pace-v0-spike`](https://github.com/ymirau/pace-v0-spike)
> (private). The agent engine here is vendored from it.

## What you see

One screen, `/`:

- **The conversation.** On load the SPA calls `POST /api/chat/open` and the agent
  produces a check-in **before you type anything**. That unprompted turn is the
  product's whole proposition, so it is the first thing the UI does.
- **A tool trace.** Small grey chips above each agent message name the tools it called
  (`get_overview`, `check_timeline`, `propose_plan`…); hover one for its arguments.
  Watching it work is half the signal.
- **The work, beside it.** Counts (overdue / stuck / blocked / on you), each person's
  open hours against capacity, and every task under its project with late and
  untouched-for-N-days flags — so a claim in the chat can be checked against the state
  without leaving the screen.
- **"Waiting on your yes."** Anything the agent initiates becomes a *pending proposal*
  that changes nothing until you approve it. Approving is one word in the chat.

## What changed from the template

`86 files changed, 2409 insertions, 5573 deletions` against the scaffold commit
(`0ce76a4`): **59 files deleted, 12 added**. Everything deleted is recoverable from that
commit.

### Deleted — the template's worked examples

| Gone | Backend | Frontend |
|---|---|---|
| **Items** (Postgres CRUD demo) | `routers/items.py`, `schemas/item.py`, `models/item.py`, `sql/002_items.sql`, `tests/test_items.py` | `api/items.ts`, `components/samples/ItemsTab.tsx` |
| **Reports** (SQL Server demo) | `routers/reports.py`, `services/reports.py`, `sources/sqlserver/`, `tests/test_reports.py` | `api/reports.ts`, `components/samples/ReportsTab.tsx` |
| **Support** (email form) | `routers/support.py`, `services/mailer.py`, `services/uploads.py`, `models/support_request.py`, `sql/003_support_requests.sql` | `pages/SupportPage.tsx`, `lib/supportMail.ts`, `lib/supportPhotos.ts`, `lib/imageResize.ts` |
| **Admin + roles** | `core/roles.py`, `routers/user_roles.py`, `models/user_role.py`, `sql/004_user_roles.sql` | `pages/AdminPage.tsx`, `components/admin/`, `lib/role.ts`, `lib/viewAs.ts`, `RoleBadge`, `ViewAsBanner`, `PeoplePicker`, `api/graph.ts` |
| **Source status / landing / tabs** | `routers/sources.py` | `pages/HomePage.tsx`, `pages/SamplesPage.tsx`, `TabBar`, `UplotChart`, `MetricTile` |

**Roles went with the admin module.** Pace is one founder looking at their own business,
so there is nobody to be an admin over. `GET /api/me` now returns email and name only.

### Added

```
backend/app/pace/                 the agent engine, vendored from the spike
  store.py tools.py agent.py logger.py
  data/seed.json                  Maya / Kiln & Co — the worked example
  data/seed_blank.json            template to fill in with your own business
  prompts/system_v1.md            versioned, never edited in place
backend/app/routers/chat.py       /api/chat/{open,message,state,reset}
backend/app/schemas/chat.py
frontend/src/api/chat.ts          TanStack Query hooks + types
frontend/src/pages/ChatPage.tsx   the conversation
frontend/src/components/pace/StatePanel.tsx   the work, beside it
```

### Kept

Auth (MSAL + the local HTTP bypass), the `Layout` shell, theme and dark mode, `/health`,
`GET /api/me`, the CI pipeline, and the per-env deploy config.

## Architecture

```
Browser ──▶ Vite dev server (proxies /api) ──▶ FastAPI ──▶ app/pace/data/state.json
                                                       └─▶ Anthropic API (claude-sonnet-5-5)
```

**State is a JSON file, not Postgres.** One founder, one dataset; the template's
database path was more machinery than the question needs, and it keeps the web app and
the terminal spike reading the same store rather than drifting apart.

**Postgres is still wired but unused.** `main.py`'s lifespan calls `init_engine()`, and
`sql/postgres/001_schema.sql` + `999_grants.sql` remain, but no application code imports
`get_session` any more and no models exist beyond `base.py`. `create_async_engine` does
not connect eagerly, so **the app runs fine with no database reachable.** Removing the
wiring is a tidy-up nobody has done yet.

The deploy shape (Azure App Proxy → Caddy → per-env path routing) is untouched from the
template — and unexercised. **This has never been deployed anywhere.**

## Run it locally

Two terminals. You need an Anthropic API key.

```bash
# 1) Backend — http://localhost:8000
cd backend
uv sync && cp -n .env.example .env
#   Fill in ANTHROPIC_API_KEY. POSTGRES_URL can stay as-is: nothing reads it.
#   AUTH_DISABLED=true is already on, so MSAL is bypassed over plain HTTP.
uv run uvicorn main:app --reload --port 8000

# 2) Frontend — http://localhost:5173
cd frontend
npm ci && npm run dev
```

Open http://localhost:5173 and the agent opens the conversation. Without a key, the two
routes that call the model (`/chat/open`, `/chat/message`) return **503** naming the
missing variable; `/chat/state`, `/api/me`, `/health` and the UI shell all still work.

The same engine runs as a terminal chat in the spike repo, which also has the scenario
script, the ratings (`/rate`) and the simulated clock (`/advance`) that this UI does not.

## API

| Route | What |
|---|---|
| `POST /api/chat/open` | The proactive check-in. Catches a real-time seed's clock up first. |
| `POST /api/chat/message` | Send a message, get the reply plus the tools it called. |
| `GET /api/chat/state` | Projects, tasks, people, proposals and the derived counts. |
| `POST /api/chat/reset` | Reload a seed (`example` or `mine`) and drop the conversation. |
| `GET /api/me` | The caller's email and name. |
| `GET /health` | Liveness, unauthenticated, at the root. |

Every `/api` route requires a token, enforced in one place by
`backend/tests/test_auth_guard.py`, which walks the route table and fails on any `/api`
route missing `get_current_user`.

## Use your own business instead of the example

```bash
cp backend/app/pace/data/seed_blank.json backend/app/pace/data/seed_mine.json
# fill it in — the file carries its own instructions — then in the UI: "use mine"
```

`seed_mine.json` is **gitignored**: it holds a real business and real people's names.
So are `state.json` and `app/pace/transcripts/`.

## Known rough edges

- **The conversation lives in process memory**, keyed per backend process. Any backend
  edit triggers `--reload`, which starts a fresh conversation. Transcripts on disk
  survive.
- **The engine is vendored, not shared.** `backend/app/pace/` is a *copy* of the spike's
  package. One behaviour today, two files to fix tomorrow.
- **Single user, not concurrent-safe.** The JSON store has no locking.
- **No `/rate`, `/advance` or `/scenario` here.** Ratings and the simulated clock are
  the experiment harness and live in the terminal spike.
- **A UI at all is a departure from the spike's spec**, which says terminal-only until
  the magic-or-annoying verdict is written. Noted so the gate review knows the surface
  came before the answer.

## Before you call a change done

```bash
cd backend  && uv run ruff check . && uv run ruff format --check . && uv run pytest -q
cd frontend && npm run lint && npm test && npm run build
```

`frontend/src/contrast.test.ts` proves every text colour meets WCAG AA on the grounds it
sits on, in both themes — so painting a new colour means adding its proof there. Build on
the `@theme` tokens in `src/index.css`, never raw Tailwind colours, or dark mode breaks.

## Config

| File | Committed? | What goes in it |
|---|---|---|
| `backend/.env.example` | yes | every backend setting, with placeholders |
| `backend/.env` | **no** (gitignored) | `ANTHROPIC_API_KEY`, `PACE_MODEL`, `PACE_SEED`, `AUTH_DISABLED=true` |
| `_deploy/envs/pace-<env>.env` | yes | per-env deploy settings — unexercised |

The shared Entra IDs are not in any env file: defaults in `backend/app/core/config.py`,
constants in `frontend/src/authConfig.ts`. The frontend has no env files.

## Branches

`develop` → sbx, `uat` → uat, `main` → prod; all three currently sit at the scaffold
commit. Never commit on them — work on `feature/*` and merge up. `.githooks/pre-commit`
refuses a commit while one is checked out.

## Tech stack

React 19 · Vite · TailwindCSS · React Router · TanStack Query · MSAL · FastAPI ·
Python 3.12 · uv · Anthropic SDK (`claude-sonnet-5-5`)
