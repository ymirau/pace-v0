# Create the GitLab repo and push — pace-v0

What to do **immediately after `/syn-init-webapp`**: create the project on
`gitlab.example.com`, point the freshly scaffolded local repo at it, and push the
three environment branches.

Where this sits in the sequence:

```
/syn-init-webapp   →   THIS DOC          →   _deploy/README.md   →   _deploy/gitlab-setup.md
scaffold + git init    create GitLab repo    provision the host      wire CI auto-deploy
                       + origin + branches   (clone, install.sh)     (runners, deploy keys)
```

Everything downstream assumes `origin` exists and `develop` / `uat` / `main` are
pushed — the host clones a branch, and CI keys off branch names.

> **This runbook is for GitLab, done by hand.** The toolkit's automated path now targets
> GitHub: run `/syn-init-github` from the project root to create a private GitHub
> repository and push `main`/`develop`/`uat`. Note that the deploy pipeline below this
> runbook is GitLab CI (`.gitlab-ci.yml`), which doesn't run on GitHub.

---

## 0. Before you start

| Need | Detail |
|------|--------|
| GitLab account | On `gitlab.example.com` (internal LAN, HTTP). |
| Permission to create the project | **Developer** or above on the target group — apps live under **`synveon`**. Ask the platform owner if you can't create there. |
| An SSH key on GitLab | Strongly recommended — see §2. Avatar → **Edit profile** → **SSH Keys**, or the [GitLab SSH docs](https://docs.gitlab.com/user/ssh/). |
| A local repo with a commit | `/syn-init-webapp` does this when you answer *yes* to "Initialize git?". Verify with `git log --oneline -1`; if there's no repo, see §1a. |

Pick the project path now — it should match the project folder name, e.g.
`synveon/pace-v0`.

---

## 1. Confirm the local repo

From the project root:

```bash
git log --oneline -1 && git branch --show-current
```

Expect one commit (`Initial scaffold from pace-v0-template`) on `main`.

### 1a. If git wasn't initialized

```bash
git init -q -b main
```

```bash
git add -A && git commit -m "Initial scaffold from pace-v0-template"
```

> The versioned hooks in `.githooks/` switch themselves on: `npm install` / `npm ci` in
> `frontend/` runs `.githooks/enable-hooks.sh` (its `prepare` script), and so do
> `/syn-start-local-servers` and the workflow skills. They block commits directly on
> `main`/`uat`/`develop`, and the `pre-push` hook best-effort mirrors
> `_workitems/features/` to the shared synnexus MinIO bucket. The mirror is
> **non-blocking** — before synnexus creds exist it prints a warning and the push
> proceeds. Run `/syn-sync-workitems` to set up the creds.

---

## 2. Create the **empty** project on GitLab

GitLab UI → **New project** → **Create blank project**:

| Field | Value |
|-------|-------|
| Project name | `pace-v0` |
| Project URL / group | `synveon` |
| Visibility | **Internal** (default for Synveon) |
| **Initialize repository with a README** | **UNCHECK — this is the one that bites** |
| Enable Static Application Security Testing | leave off |

> **Why unchecked matters.** A README commit creates a root commit on the remote
> that shares no history with your scaffold commit, so the first push is rejected
> as non-fast-forward. Recovery is in §7.

Then **Create project**. Leave the "push an existing folder" instructions on
screen — the next step is the same thing, with the Synveon specifics filled in.

<details>
<summary>Alternative: create it from the CLI with <code>glab</code></summary>

```bash
glab repo create synveon/pace-v0 --internal --defaultBranch main
```

`glab` adds `origin` for you, so skip §3's `git remote add` and go straight to the
push. Authenticate first with `glab auth login --hostname gitlab.example.com`.
</details>

---

## 3. Add the remote and push `main`

**SSH is the recommended form** — it authenticates non-interactively, which HTTP
can't:

```bash
git remote add origin git@gitlab.example.com:synveon/pace-v0.git
```

```bash
git push -u origin main
```

Verify:

```bash
git remote -v && git ls-remote --heads origin
```

> **The `http://` alternative — and its caveat.** `git remote add origin
> http://gitlab.example.com/synveon/pace-v0.git` works and is
> simpler to start, but it can't authenticate non-interactively. Later pushes from
> Claude Code, the deploy scripts, or any automation fail with `fatal: could not
> read Username for 'http://gitlab.example.com'`. Switch with
> `git remote set-url origin git@…` and push again.
>
> The **host** checkout is the opposite case — the provisioning runbook clones over
> HTTPS with a personal access token by default, because the service user has no key
> yet; it then adds a read-only deploy key. See
> [README.md](README.md#first-time-host-provisioning--sbx-on-app-server-02).

---

## 4. Create the environment branches

Three long-lived branches, one per environment — this is what CI keys off
([.gitlab-ci.yml](../.gitlab-ci.yml)):

| Branch | Environment | Deploy trigger |
|--------|-------------|----------------|
| `develop` | sbx | auto on push |
| `uat` | UAT | auto on push |
| `main` | PROD | **manual** button on the pipeline |

Create both from `main` so all three start identical:

```bash
git branch develop main && git branch uat main
```

```bash
git push -u origin develop uat
```

Confirm all three exist on the remote:

```bash
git ls-remote --heads origin
```

> The first push fires a pipeline. Until the runners are enabled for this project
> (§6), jobs sit **pending** — that's expected, not a misconfiguration.

---

## 5. Repository settings (GitLab UI)

1. **Default branch** — Settings → Repository → **Branch defaults** → set to
   **`develop`**. Day-to-day work merges into `develop` (→ sbx), so MRs should
   target it by default.

2. **Protected branches** — Settings → Repository → **Protected branches** →
   protect **`uat`** and **`main`**:

   | Branch | Allowed to merge | Allowed to push |
   |--------|------------------|-----------------|
   | `main` | Maintainers | No one (merge only) |
   | `uat` | Maintainers | No one (merge only) |
   | `develop` | *leave unprotected* | — |

   Do this **before** adding the CI variables in
   [gitlab-setup.md](gitlab-setup.md#4-gitlab-cicd-variables--branch-protection):
   `SSH_KEY_UAT` / `SSH_KEY_PROD` are stored as **Protected** variables, which are
   only exposed to pipelines on protected branches. Protecting a branch does *not*
   block auto-deploy — a merge to `uat` still triggers `deploy-uat`.

3. **Optional:** Settings → Merge requests → enable **Delete source branch by
   default** and **Squash commits**, to match how the feature-branch skills work.

---

## 6. What's next

| Then | Doc |
|------|-----|
| Provision the host (clone, `install.sh`, secrets, service) | [README.md](README.md#first-time-host-provisioning--sbx-on-app-server-02) |
| Wire CI auto-deploy (runners, deploy keys, variables) | [gitlab-setup.md](gitlab-setup.md) |
| Guided, one-step-at-a-time version of both | the `/syn-provision-webapp-host` skill |

Also queue up the things that need other people, since they gate the first real deploy: a
**unique `API_PORT` block** from the platform owner, and a **DBA** to create the schema,
tables, and grants. Entra needs **nothing** for a new app — login goes through the
host-wide shared `/auth-callback/`, whose single SPA redirect URI is registered once per
host. All of it is in
[README.md](README.md#human--infra-prerequisites-cannot-be-done-from-this-repo).

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `! [rejected] main -> main (fetch first)` on the very first push | The GitLab project was created **with** a README (§2). If nothing else has been pushed, the cleanest fix is to drop the remote commit: `git push --force origin main`. Only safe because you are the sole author of that repo — never do this once teammates have pushed. Alternatively `git pull --rebase --allow-unrelated-histories origin main` and resolve. |
| `fatal: could not read Username for 'http://gitlab.example.com'` | HTTP remote in a non-interactive context. `git remote set-url origin git@gitlab.example.com:synveon/pace-v0.git`. |
| `git@gitlab.example.com: Permission denied (publickey)` | No SSH key on your GitLab account, or the wrong key is offered. Check with `ssh -T git@gitlab.example.com`; add the key under avatar → **Edit profile** → **SSH Keys**. |
| `remote: The project you were looking for could not be found` | Wrong group/path, or you lack access to `synveon`. Confirm the path in the browser URL and ask the platform owner for Developer on the group. |
| Pre-push warning about synnexus / MinIO | Expected before creds exist — the hook is non-blocking and the push still completes. Run `/syn-sync-workitems` to configure it. |
| Pipeline jobs stuck **pending** after the first push | Runners aren't enabled for this project yet — [gitlab-setup.md §2](gitlab-setup.md#2-give-this-project-a-runner-reuse-the-existing-ai01-runners). |
| Pushed to `develop` but nothing deployed | Normal until CI is wired: the runner assignment, deploy keys, and `SSH_KEY_*` variables all come from [gitlab-setup.md](gitlab-setup.md). |
