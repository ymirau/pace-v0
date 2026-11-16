# GitLab CI/CD setup — pace-v0

How pace auto-deploys through GitLab CI/CD. The runner lives on
**`ai-server-01`**; deploy jobs SSH **cross-host** to the per-env service user on
**`app-server-02`**, where all three envs run behind the shared Caddy. **Push is the
only action:** push to `develop` → SBX, push to `uat` → UAT, manual button on
`main` → PROD.

This reuses the **existing `gitlab-runner` install on `ai-server-01`** (the platform's
project runners, shared with pace) — nothing new is installed on the runner host.

- Pipeline definition: [.gitlab-ci.yml](../.gitlab-ci.yml)
- What a deploy does on the host: [_deploy/README.md](README.md), [_deploy/scripts/deploy.sh](scripts/deploy.sh)
- **Prerequisite** — creating the GitLab project itself, adding `origin`, and pushing
  the three branches: [_deploy/gitlab-repo-setup.md](gitlab-repo-setup.md)

---

## 1. Topology

```
┌──────────────────────────────┐        ┌────────────────────────────────────┐
│  ai-server-01  (runner host) │        │  app-server-02  (sbx/uat/prod host)  │
│  gitlab-runner (shared)      │  ssh   │  synappssbx-pace  → @sbx        │
│   • docker → lint/test/build │───────►│  synapps-pace     → @uat,@prod  │
│   • shell  → deploy.sh       │ cross- │  /opt/synveon/pace-<env>     │
│  ~/.ssh/id_ed25519_pace_<env>   │  /var/www/html/<segment>/ dist        │
│                              │  host  │  /etc/pace-<env>.env (secrets) │
└──────────────────────────────┘        └────────────────────────────────────┘
            │ push / pipeline
            ▼
   gitlab.example.com  (HTTP, internal LAN)
```

| Env | Branch | Service user (lx02) | API port | Trigger |
|-----|--------|---------------------|----------|---------|
| sbx | `develop` | `synappssbx-pace` | 8014 | auto on push |
| uat | `uat` | `synapps-pace` | 8013 | auto on push |
| prod | `main` | `synapps-pace` | 8012 | **manual** button |

SBX has its own service user (isolated from prod-grade data); **UAT and PROD share
`synapps-pace`** because they run the same prod-grade secrets.

---

## 2. Give this project a runner (reuse the existing ai01 runners)

The `docker` + `shell` runners on `ai-server-01` are project-locked to
`synveon/platform`. The simplest way to let pace use them — **no
re-registration, no host changes** — is to unlock and assign them (needs
**Maintainer** on both `synveon/platform` and pace):

1. For each existing runner (`synveon/platform` → Settings → CI/CD → Runners →
   edit the runner): turn **off** "Lock to current projects."
2. pace → Settings → CI/CD → Runners → under **Project runners**, click
   **Enable for this project** on the `docker` and `shell` runners.
3. Confirm both show **online / available** for pace.

This keeps them **project runners shared across both projects** — a runner's type
(instance / group / project) is fixed at registration, so unchecking the lock only
enables multi-project assignment; it does not convert them to group runners.

> **Deferred — group runners (for later scale):** if many more `synveon` projects
> end up needing these runners, re-register them as **group** runners (Group → Build
> → Runners → New group runner → `gitlab-runner register --token glrt-… --executor
> docker|shell` on ai01, same install), then unregister the project-locked ones.
> Needs group **Owner**. Not needed for pace today.

> Because untagged jobs are off, **every** job in [.gitlab-ci.yml](../.gitlab-ci.yml)
> sets a tag — `docker` for lint/test/build, `shell` for deploy. Assigning the
> existing runners preserves those tags.
>
> **Shell-runner toolchain:** [deploy.sh](scripts/deploy.sh) builds the SPA *on the runner*,
> so the shell executor needs `node`, `npm`, `uv`, `rsync`, and `ssh` on PATH.
> Verify before the first deploy; if you'd rather not put node/uv on the shell
> runner, see the artifact-split follow-up in §6.

---

## 3. Deploy SSH keys (one per env)

Run on **`ai-server-01`** as the `gitlab-runner` user. Repeat for `sbx`, `uat`,
`prod`, authorizing the matching service user: **sbx → `synappssbx-pace`**,
**uat & prod → `synapps-pace`** (both on `app-server-02`).

```bash
# 1. Generate a per-env deploy key
sudo -u gitlab-runner ssh-keygen -t ed25519 \
  -f /home/gitlab-runner/.ssh/id_ed25519_pace_<env> \
  -N "" -C "gitlab-ci-pace-<env>@ai-server-01"

# 2. Authorize the PUBLIC key on the env's service user, on app-server-02.
#    Don't pipe it across hosts (`| ssh app-server-02 'sudo tee …'`): the remote sudo
#    has no terminal for its password prompt. Instead, print the finished append
#    command here, key already filled in:
printf "echo '%s' | sudo tee -a /home/<service-user>/.ssh/authorized_keys >/dev/null\n" \
  "$(sudo cat /home/gitlab-runner/.ssh/id_ed25519_pace_<env>.pub)"
#    then copy the printed line and run it as is on app-server-02. install.sh already
#    created ~<service-user>/.ssh (700) + authorized_keys (600), so the append just works.

# 3. known_hosts — app-server-02 is already in the SSH_KNOWN_HOSTS variable from
#    the platform setup; reuse it. Re-scan only if lx02 was rebuilt:
#      ssh-keyscan -H ai-server-01 app-server-02

# 4. Verify (cross-host)
sudo -u gitlab-runner ssh -i /home/gitlab-runner/.ssh/id_ed25519_pace_<env> \
  -o BatchMode=yes <service-user>@app-server-02 'echo ok=$(whoami)@$(hostname)'
# Expect: ok=<service-user>@app-server-02

# 5. Base64 the private key for the GitLab variable
sudo base64 -w 0 /home/gitlab-runner/.ssh/id_ed25519_pace_<env>
```

---

## 4. GitLab CI/CD variables + branch protection

pace project → **Settings → CI/CD → Variables**:

| Key | Value | Mask | Protect |
|-----|-------|------|---------|
| `SSH_KEY_SBX` | base64 of `id_ed25519_pace_sbx` | ✓ | ✗ (`develop` not protected) |
| `SSH_KEY_UAT` | base64 of `id_ed25519_pace_uat` | ✓ | ✅ |
| `SSH_KEY_PROD` | base64 of `id_ed25519_pace_prod` | ✓ | ✅ |
| `SSH_KNOWN_HOSTS` | `ssh-keyscan -H ai-server-01 app-server-02` | ✗ | ✗ (set at **group** level to share) |

**Before adding the uat/prod keys:** Settings → Repository → **Protected branches**
→ mark **`uat`** and **`main`** Protected, then mark `SSH_KEY_UAT` / `SSH_KEY_PROD`
as **Protected variables**.

> Protecting a branch does **not** block auto-deploy — a merge/push to `uat` still
> triggers `deploy-uat` (the rule fires on push). Protection governs who may
> push/merge **and** makes Protected variables available to the branch's pipelines
> while hiding them from feature-branch pipelines. That matters here because
> `SSH_KEY_UAT/PROD` reach the shared prod-grade account `synapps-pace`.
>
> The meaningful isolation boundary is **sbx vs uat/prod**: `SSH_KEY_SBX` reaches
> only `synappssbx-pace`. `SSH_KEY_UAT` and `SSH_KEY_PROD` both authorize
> `synapps-pace`, so their separation is nominal for *access* — kept as two
> keys for clean rotation/audit and because `uat`/`main` are distinct protected
> branches.

---

## 5. Bring up an environment (order)

Do envs one at a time — **sbx, then uat, then prod**. Per env:

1. **Branch** — create `develop` / `uat` / `main` and push
   ([gitlab-repo-setup.md](gitlab-repo-setup.md), if you haven't already).
2. **Host** — clone at `INSTALL_ROOT`, then `sudo _deploy/scripts/install.sh <env>`
   (see [_deploy/README.md](README.md#first-time-host-provisioning)). It creates the
   service user(s), dirs, venv, systemd unit (+ per-env `User=` drop-in), the
   **sudoers grant**, Caddy route, and gates on secrets. Verify by hand:
   `./_deploy/scripts/deploy.sh <env>` from local WSL, then `curl -s localhost:<port>/health`.
3. **CI** — once only, enable the shared runners for pace (§2). Then per env:
   generate the key (§3), set the variable + protect the branch (§4), and push to
   the branch (sbx/uat) or click the manual `deploy-prod` button.

**sudoers** — `install.sh` writes this per env (so [deploy.sh](scripts/deploy.sh) can
restart over SSH); shown here for reference, in `/etc/sudoers.d/pace-api-<env>`:

```
synappssbx-pace ALL=(root) NOPASSWD: /usr/bin/systemctl restart pace-api@sbx, /usr/bin/systemctl status pace-api@sbx
synapps-pace    ALL=(root) NOPASSWD: /usr/bin/systemctl restart pace-api@uat, /usr/bin/systemctl status pace-api@uat
synapps-pace    ALL=(root) NOPASSWD: /usr/bin/systemctl restart pace-api@prod, /usr/bin/systemctl status pace-api@prod
```

---

## 6. Rotation, follow-ups

- **Rotate a key:** regenerate on ai01 (§3.1), append the new pubkey to the service
  user on lx02, update the GitLab variable, delete the old `authorized_keys` line,
  re-run a pipeline.
- **Avoid node/uv on the shell runner:** add docker `build-<env>` jobs that publish
  `frontend/dist` as artifacts and a `--prebuilt` path in [deploy.sh](scripts/deploy.sh) so
  the shell deploy job skips the local build (this is the platform's pattern).
- **Caddy/systemd config changes** (ports, base paths, the `@sbx` drop-in) are
  **not** re-rendered by CI — apply them by hand on the host.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Job stays **pending** forever | The shared runners aren't enabled for pace, or the tag is wrong — confirm the `docker`/`shell` runners show available under the pace project (§2) and the job's tag matches. |
| `Permission denied (publickey)` | Pubkey not in the env's service-user `authorized_keys` on lx02, or `SSH_KEY_*` doesn't match. Compare `ssh-keygen -y -f …` (ai01) against `authorized_keys` (lx02). |
| `Host key verification failed` | `SSH_KNOWN_HOSTS` missing/stale `app-server-02` — re-run `ssh-keyscan -H ai-server-01 app-server-02` and update the variable. |
| Deploy fails on `systemctl restart` | sudoers grant missing for that env's user (§5). |
| `npm`/`uv`/`rsync: not found` in deploy | Shell-runner toolchain missing — install them, or switch to the artifact split (§6). |
| Service runs as the wrong user | Missing `@sbx` drop-in — `systemctl show -p User pace-api@sbx` should be `synappssbx-pace`; `daemon-reload` after adding it. |
