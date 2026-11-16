# _workitems — Product Workflow

This folder holds the app's **product workflow**: a lightweight, file-based pipeline
for turning a pile of user requests into tracked, well-specified, implemented features.
Everything here runs from the **repo root** (open Claude at the app root), because the
skills that drive it are global (`~/.claude/skills/`) and read/write `_workitems/` in
whatever repo you're in.

---

## The pipeline

```
/triage → /planning → /prd → /syn-implement-feature → /syn-promote-feature → /syn-mark-feature-shipped
stage 0   per feature  spec   branch + build mode      sbx → uat → prod   after the prod deploy
                              (→ /ralph, optional)
```

| Stage | Invoke | Reads | Writes |
|---|---|---|---|
| 0. Triage raw requests | `/triage` | a dump of user asks | `_workitems/features/backlog.md` (living) |
| 1. Explore requirements | `/planning` | the backlog entry | `_workitems/features/planning/planning-<slug>.md` |
| 2. Write the spec | `/prd` | the planning summary | `_workitems/features/prd/prd-<slug>.md` |
| 3. Start the build | `/syn-implement-feature` | the backlog entry (+ PRD if any) | backlog → `in-progress` (on `develop`); then branch `feature/<slug>` |
| 3a. Convert for the agent *(optional)* | `/ralph` | the PRD | `_workitems/ralph/prd.json` |
| 3b. Execute autonomously *(optional)* | `_workitems/ralph/ralph-loop.sh [N]` | `prd.json` | git commits + `progress.txt` |
| 4. Promote to an environment | `/syn-promote-feature <sbx\|uat\|prod>` | the branch ladder + the backlog | merges + pushes the target branch; `sbx` only: backlog → `in-progress` + **Deployed env** `pre-prod` / sbx **Deployed URL** |
| 5. Close out after prod | `/syn-mark-feature-shipped` | the backlog entry | backlog → `shipped` + **Shipped** date + **Deployed env** `prod`; `develop` synced & pushed |

### How `_workitems/` changes get committed

**`develop` holds the backlog, and nothing is ever committed on it directly** — nor on
`uat` or `main`. When `/triage`, `/planning`, `/prd`, `/syn-implement-feature` (its
kickoff) or `/syn-mark-feature-shipped` write under `_workitems/`, each one commits on a
short-lived `chore/workitems-*` branch in a temporary worktree and **fast-forwards**
`develop` to it, then deletes the branch. That happens automatically, from whatever branch
you're on (your checkout is never switched), and nothing is pushed. `/syn-promote-feature
sbx` records on the feature branch, so the record reaches `develop` inside the merge;
`uat` and `prod` promotions are pure merges. A repo without `develop` (a tools repo) is
asked once which branch holds the backlog (`git config workitems.branch`). The shared
helper is the toolkit's `syn-init-branches/workitems-commit.sh`.

The stages are a pipeline **by convention, not by hard dependency**. The only ordering
rule the tooling enforces is *planning-before-PRD* (`/prd` refuses to run until a planning
summary exists). Triage and Ralph are both optional, and `/syn-implement-feature` works
on a feature that skipped planning/prd — it just hands you the branch instead of offering
a build mode.

### Publishing to synnexus (cross-project view)

`features/` is also mirrored **one-way** to the shared **synnexus** MinIO bucket
(`product-workitems/<app-slug>/features/...`) so a separate app can show a holistic
view of every project. Local is always the source of truth — nothing is ever pulled
back. Two triggers: the git `pre-push` hook (`.githooks/pre-push`, syncs on every push;
the sync never blocks it — the same hook's separate merge-only check on `uat`/`main` can) and the on-demand **`/syn-sync-workitems`** skill
(guaranteed full mirror + first-run credential setup). Set creds once per machine
(`~/.config/synnexus.env`); see `.githooks/synnexus.env.example`.

---

## Folder layout

```
_workitems/
├── README.md                   # this file
├── features/                   # all generated planning/PRD/backlog markdown
│   ├── backlog.md              # the living, status-tracked backlog (from /triage)
│   ├── planning/               # one planning-<slug>.md per feature (from /planning)
│   ├── prd/                    # one prd-<slug>.md per feature (from /prd)
│   └── images/                 # preserved mockups/screenshots, linked from backlog/PRDs
└── ralph/                      # the autonomous runner
    ├── CLAUDE.md               # standing instructions for the Ralph agent
    ├── ralph-loop.sh           # unattended runner (loop + circuit breaker)
    ├── ralph-once.sh           # single hand-stepped iteration
    ├── prd.json                # the machine-readable spec Ralph executes (from /ralph)
    └── progress.txt            # Ralph's append-only run log (git-ignored)
```

The **slug** (e.g. `auth-sso`) is assigned during triage and is the canonical `<feature>`
name carried through every downstream file.

---

## The stages in detail

### Stage 0 — `/triage`
Turns a raw, unstructured dump of user requests into a structured backlog. It numbers
every request (loses nothing), clusters related asks into **candidate features**, merges
duplicates, splits bundles, assigns slugs, rough-sizes each (`S`, `S/M`, `M`, `M/L`, `L`
— the only permitted values), notes dependencies,
and flags anything too vague to act on. It confirms the grouping with you before writing.

Output is a single **living** file, `features/backlog.md`, where each feature carries a
status that advances through the pipeline:

```
triaged → planning → prd → in-progress → shipped     (or parked)
```

`/triage` is **re-runnable**: run it again whenever new requests arrive and it folds them
into the existing backlog without clobbering existing slugs, statuses, or notes (statuses
only move forward).

The backlog also records **who** did the work, taken from `git config user.name` /
`user.email`. Its header carries an **Initial contributor** (the project's owner, asked
for by `/syn-init-webapp` and never changed afterwards) and a **Last contributor** (whoever
last ran a workflow skill on it, with the date), and each feature has a **Contributors**
line listing everyone who triaged, planned, specced, started, promoted or shipped it.
Every workflow skill updates these automatically through one shared helper
(`backlog-stamp.sh`); you can edit them by hand and the skills keep your edits.

### Stage 1 — `/planning`
Forces **5 mandatory rounds** of Q&A before a PRD can be written: Problem Understanding →
Scope → Technical Constraints → Edge Cases → Verification Strategy. You answer lettered
multiple-choice questions, so it's fast. Output is `features/planning/planning-<slug>.md`.
If a backlog entry exists, planning bumps its status `triaged → planning`.

### Stage 2 — `/prd`
Checks that a planning summary exists first (sends you back to `/planning` if not), asks a
few clarifying questions, then produces `features/prd/prd-<slug>.md`: overview, goals, **user
stories with verifiable acceptance-criteria checklists**, functional requirements,
non-goals, success metrics. If a backlog entry exists, it bumps the status
`planning → prd`. This file is your tracking artifact even if you never touch Ralph.

### Stage 3 — `/syn-implement-feature`
Starts the work. Resolves the working branch (prefers `develop`; asks if there isn't
one), flips the backlog entry to `in-progress` with a fresh **Last worked on** date —
committed to `develop` the way described above, so `develop` shows the work as started —
then cuts **`feature/<slug>`** off the updated `develop`. The feature branch starts with
nothing to commit. Then it routes on whether a PRD exists: with one, it
asks whether to build via **Ralph** (Stage 3a) or **interactively** from the PRD;
without one, it simply hands you the branch and waits. It never merges, pushes, or
deploys.

### Stage 3a — `/ralph` (optional)
Converts a PRD into `ralph/prd.json` — the format the autonomous runner consumes. It
splits stories to one-iteration size and rewrites every acceptance criterion to be
machine-verifiable.

### Stage 3b — the Ralph runner (optional)
`ralph/ralph-loop.sh [N]` launches a fresh Claude Code instance per iteration **with the
repo root as its working directory** (so it loads the root `CLAUDE.md` and the shared
skills). Each iteration picks the highest-priority unfinished story, implements it, runs
quality gates, commits `feat: US-XXX`, and appends learnings to `progress.txt`. It has a
security pre-flight, a per-story circuit breaker, and a completion gate. Use
`ralph-once.sh` to hand-step a single iteration.

### Stage 4 — `/syn-promote-feature`
Moves the code up the environment ladder. One argument picks the environment, and the
merge direction follows from it:

| Mode | Merges | Into | The push |
|---|---|---|---|
| `sbx` | your current branch | `develop` | auto-deploys SBX |
| `uat` | `develop` | `uat` | auto-deploys UAT |
| `prod` | `uat` | `main` | **deploys nothing** — prod is a manual GitLab button |

An app with no uat environment has no `uat` branch: there, `prod` merges `develop` into
`main`, and `uat` mode stops with a note. The `uat` branch's presence is what decides this;
`/syn-init-webapp` and `/syn-init-branches` ask once, when the branches are first set up.

**Only `sbx` writes to the backlog**, on the feature branch before merging it: status
`in-progress` and a **Deployed** line — `**Deployed env:** pre-prod · **Deployed URL:**
<sbx url>` — read from `_deploy/envs/<app-slug>-sbx.env`, not guessed. `pre-prod` covers
sbx and uat, so it stays true through the `uat` promotion.

**`uat` and `prod` are pure merges** with no backlog write, so `uat` and `main` never get a
commit of their own. Neither sets `shipped` or records prod: pushing `main` only makes the
code available to the prod pipeline; a human still presses the deploy button. Both are
Stage 5's job.

### Stage 5 — `/syn-mark-feature-shipped`
Run **after** the feature is live in production (the prod deploy is a manual button, so
nothing can infer this for you). It brings `develop` up to date with `main`, flips the
backlog entry to `shipped`, records a **Shipped** date, sets **Deployed env** to `prod`
with the matching **Deployed URL** (read from `_deploy/envs/<app-slug>-prod.env`) —
committed the way described above — then pushes `develop`. This is the one status change no other stage makes
automatically — and the only place `prod` is ever written, because it's the only point where
a human has confirmed the deploy happened.

---

## How to run it

Always from the repo root:

```bash
# In a Claude Code session opened at the repo root:
/triage                              # paste your pile of requests; produces features/backlog.md
/planning <slug>                     # 5-round Q&A; produces features/planning/planning-<slug>.md
/prd <slug>                          # spec; produces features/prd/prd-<slug>.md
/syn-implement-feature <slug>        # cuts feature/<slug>, marks in-progress, picks a build mode
/syn-promote-feature sbx                 # merges your branch into develop and pushes: SBX auto-deploys
/syn-promote-feature uat                 # merges develop into uat and pushes: UAT auto-deploys
/syn-promote-feature prod                # merges uat into main and pushes; then press the prod button
/syn-mark-feature-shipped <slug>     # after the prod deploy: marks shipped, syncs develop

# Optional autonomous execution (from a terminal at the repo root):
_workitems/ralph/ralph-loop.sh 10    # up to 10 unattended iterations
_workitems/ralph/ralph-once.sh        # a single iteration
```

---

## Notes

- Ralph's per-run state (`progress.txt`, `archive/`, and the `.last-branch` /
  `.last-story` / `.story-attempts` trackers) is git-ignored; `prd.json` is tracked as the
  per-feature spec.
- The runner resolves the repo root (via `git rev-parse`) and runs Claude from there, so
  the agent always loads the root `CLAUDE.md` and the shared skills.
- **Browser verification:** the "Verify in browser using dev-browser skill" acceptance
  criterion on UI stories becomes live automatically when Claude runs at an app root that
  has a browser-automation MCP (e.g. Playwright) configured. If none is configured, verify
  UI stories manually (open the dev URL yourself).
