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

- **The conversation.** On load the SPA streams `POST /api/chat/stream` and the agent
  produces a check-in **before you type anything**. That unprompted turn is the
  product's whole proposition, so it is the first thing the UI does.
- **The turn, as it happens.** A turn is two API calls and about seven seconds of the
  model generating, and nothing makes that shorter — so the wait says what it is doing
  ("Pace is drafting a plan…") and the reply appears as it is written. Reopening the app
  is instant: a conversation already under way replays its last reply instead of paying
  for another one.
- **A tool trace.** Small grey chips above each agent message name the tools it called
  (`get_overview`, `check_timeline`, `propose_plan`…); hover one for its arguments.
  Watching it work is half the signal.
- **The work, beside it.** Counts (overdue / stuck / blocked / on you), each person's
  open hours against capacity, and every task under its project with late and
  untouched-for-N-days flags — so a claim in the chat can be checked against the state
  without leaving the screen.
- **"Waiting on your yes."** Anything the agent initiates becomes a *pending proposal*
  that changes nothing until you approve it. Approving is one word in the chat.
- **Magic or annoying, per turn.** Under each of Pace's messages: how it felt (magic /
  meh / annoying) and what it cost to clean up (0 used as-is … 3 redid it myself), plus
  an optional note. Both halves are needed before a rating counts — a reply can feel
  magic and still need heavy editing, and that gap is the finding.

And `/log`: every session, every turn, every tool call and every rating, with the
close-out numbers (average cleanup, % used as-is, proposal approve rate, cap hits, and a
per-prompt-version breakdown) computed from the log rather than by hand. Read-only — a
log you can tidy up afterwards is worth nothing.

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

Two stores, on purpose:

| What | Where | Why |
|---|---|---|
| The **log** — sessions, turns, tool calls, ratings | **Postgres** (`pace.chat_*`) | It has to survive a restart and a redeploy, and be queryable for the stats. This is v0's actual deliverable. |
| The **conversation** — the Messages API history | **Postgres** (`chat_sessions.messages`) | A serverless request can land on a cold worker. Each turn loads the history, runs, writes it back. |
| The **business** — projects, tasks, proposals | **Postgres** (`pace.pace_state`, one JSONB document) | Survives a restart and a serverless recycle. Stored as one document because the engine owns its shape; normalising it would mean rewriting every tool and splitting the web copy from the terminal one. Last write wins — fine for one founder, not multi-user. |

Log writes are **best-effort**: if Postgres is unreachable the reply still stands and the
failure is logged. A lost log line is bad; a chat that 500s because the log was down is
worse.

## Run it locally

Two terminals. You need an Anthropic API key.

```bash
# 1) Backend — http://localhost:8000
cd backend
uv sync && cp -n .env.example .env
#   Fill in ANTHROPIC_API_KEY and POSTGRES_URL (the log needs a database).
#   AUTH_DISABLED=true is already on, so MSAL is bypassed over plain HTTP.
# Create the log tables once, as the database OWNER (the app role can't run DDL):
psql -d <your db> -f sql/postgres/001_schema.sql -f sql/postgres/002_chat.sql \
     -f sql/postgres/003_state.sql
psql -d <your db> -f sql/postgres/999_grants.sql
uv run uvicorn main:app --reload --port 8000

# 2) Frontend — http://localhost:5173
cd frontend
npm ci && npm run dev
```

Open http://localhost:5173 and the agent opens the conversation. Without a key, the two
routes that call the model (`/chat/stream`, `/chat/open`, `/chat/message`) return **503** naming the
missing variable; `/chat/state`, `/api/me`, `/health` and the UI shell all still work.

The same engine runs as a terminal chat in the spike repo, which also has the scenario
script, the ratings (`/rate`) and the simulated clock (`/advance`) that this UI does not.

## API

| Route | What |
|---|---|
| `POST /api/chat/stream` | A turn as server-sent events: `tool`, `text`, `done`. `{"text": null}` is the check-in. What the UI uses. |
| `POST /api/chat/open` | The proactive check-in, waited out in one response. Catches a real-time seed's clock up first. |
| `POST /api/chat/message` | Send a message, get the reply plus the tools it called. |
| `GET /api/chat/state` | Projects, tasks, people, proposals and the derived counts. |
| `POST /api/chat/reset` | Reload a seed (`example` or `blank`) and start a new conversation. |
| `POST /api/chat/rate` | Score a turn: 0–3 cleanup cost plus magic / meh / annoying. Re-rating replaces. |
| `GET /api/log/sessions` | Every session, newest first, with turn and rating counts. |
| `GET /api/log/sessions/{id}` | One session's full transcript. |
| `GET /api/log/stats` | The close-out numbers. |
| `GET /api/me` | The caller's email and name. |
| `GET /health` | Liveness, unauthenticated and ungated, at the root. |

Every `/api` route needs a token **and**, when `PACE_ACCESS_CODE` is set, the shared code
in an `X-Pace-Access-Code` header. The code is **not authentication** — one secret, no
identity, no audit — it exists so a review link can't run up the Anthropic bill. Empty
locally, which leaves the gate open; **set it in every deployed env.**

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

## Deploying

`vercel.json` + `api/index.py` put the SPA on Vercel's CDN and FastAPI in a Python
function. Required environment variables on Vercel:

| Variable | Why |
|---|---|
| `ANTHROPIC_API_KEY` | the agent |
| `POSTGRES_URL` | `postgresql+asyncpg://…` — a hosted database (Neon et al.); the log and the conversation live here |
| `PACE_ACCESS_CODE` | the shared gate. **Without it the URL is an open tap on your API key.** |
| `AUTH_DISABLED` | `true`, because the reviewer has no Azure account and the access code is the gate instead |

Apply `sql/postgres/001_schema.sql`, `002_chat.sql` and `003_state.sql` to that database
first, as its owner, then `999_grants.sql`.

Verified end to end: a task added through the chat survives a cold process restart
**with `state.json` deleted**, and the conversation resumes from Postgres rather than
greeting you again. The JSON file is now only a local convenience; Postgres is the truth.

`AUTH_DISABLED=true` outside local dev contradicts the template's invariant 4, and it is
a deliberate, narrow exception for an unauthenticated review link gated by a shared code.
Don't carry the pattern into anything real.

## Known rough edges

- **An opening check-in costs about 7 seconds**, and that is the model generating, not
  a slow backend: prompt-caching the 3.9k-token tools-and-prompt prefix and cutting a
  round trip were both measured and both landed inside the noise. Dropping the
  `propose_plan` step would take it to ~4s with the first words at ~1s — faster, but it
  gives up the approve-with-one-yes turn the product is built on.
- **The engine is vendored, not shared.** `backend/app/pace/` is a *copy* of the spike's
  package. One behaviour today, two files to fix tomorrow.
- **Single user, not concurrent-safe.** The JSON store has no locking.
- **No `/advance` or `/scenario` here.** The simulated clock is the experiment harness
  and lives in the terminal spike. Rating a turn works in both.
- **Last write wins on the state document.** No locking, no optimistic concurrency. Two
  browser tabs would clobber each other.
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
| `backend/.env` | **no** (gitignored) | `ANTHROPIC_API_KEY`, `PACE_MODEL`, `PACE_SEED`, `PACE_ACCESS_CODE`, `POSTGRES_URL`, `AUTH_DISABLED=true` |
| `requirements.txt` | yes | Vercel's Python runtime installs from this; mirrors `backend/pyproject.toml` |
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
