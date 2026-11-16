#!/usr/bin/env bash
# sync-workitems.sh — push-only mirror of _workitems/features/ to the shared
# synnexus MinIO bucket, so a cross-project app can show a holistic view of every
# project's product-workflow state.
#
# INVARIANT: this script is PUSH-ONLY. It never downloads, pulls, or reads objects
# from the bucket, and never writes into _workitems/. The local repo is the source
# of truth; MinIO is mirrored to match it exactly (including deletions). There is
# deliberately no restore/pull code path.
#
# WHAT IS MIRRORED: the committed _workitems/features/ on the working branch
# (git config workitems.branch, else develop), not whatever happens to be checked
# out. uat and main carry older backlog snapshots by design, so mirroring the
# checkout when pushing them would roll the shared view back. A repo with neither
# falls back to the checked-out folder, with a warning.
#
# Stored at:  <bucket>/product-workitems/<app-slug>/features/...   (default bucket: synnexus)
#   In mc commands this is written "<alias>/<bucket>/<key>", where the alias is a
#   LOCAL connection nickname (kept in ~/.mc/config.json) and is NOT part of the
#   stored path. We use alias "synx" so the bucket ("synnexus") is unambiguous.
# Creds:    ~/.config/synnexus.env  (SYNNEXUS_ENDPOINT/ACCESS_KEY/SECRET_KEY[/BUCKET])
#           — a SEPARATE connection from any project's MINIO_* backend config.
#
# Usage:
#   sync-workitems.sh mirror          # full local->remote mirror (default)
#   sync-workitems.sh push <file>     # push a single file under _workitems/ (testing)
#
# Exit codes: 0 ok / no-op · 2 usage · 3 creds missing · other = mc/network failure.
# Callers decide whether a non-zero result blocks (the git pre-push hook does NOT).

set -euo pipefail

CMD="${1:-mirror}"

# --- repo root (run from anywhere) ---------------------------------------------
if ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then :; else ROOT="$PWD"; fi
FEATURES_DIR="$ROOT/_workitems/features"

# --- 1. load credentials -------------------------------------------------------
if [ -z "${SYNNEXUS_ENDPOINT:-}" ] || [ -z "${SYNNEXUS_ACCESS_KEY:-}" ] || [ -z "${SYNNEXUS_SECRET_KEY:-}" ]; then
  if [ -f "$HOME/.config/synnexus.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$HOME/.config/synnexus.env"
    set +a
  fi
fi
if [ -z "${SYNNEXUS_ENDPOINT:-}" ] || [ -z "${SYNNEXUS_ACCESS_KEY:-}" ] || [ -z "${SYNNEXUS_SECRET_KEY:-}" ]; then
  echo "synnexus creds missing: fill in SYNNEXUS_ACCESS_KEY and SYNNEXUS_SECRET_KEY (and SYNNEXUS_ENDPOINT) in ~/.config/synnexus.env (run /syn-sync-workitems to create the file if it's missing)." >&2
  exit 3
fi
SYNNEXUS_BUCKET="${SYNNEXUS_BUCKET:-synnexus}"
MC_ALIAS="synx"   # local mc connection nickname — NOT part of the stored path

# --- 2. ensure mc (auto-download static binary if absent) ----------------------
# A pinned release from MinIO's GitHub releases, checked against its published
# SHA-256 (dl.min.io/client/mc/... stopped serving it: HTTP 410).
MC_RELEASE="${MC_RELEASE:-RELEASE.2025-08-13T08-35-41Z}"
# ~/.local/bin (where this installs mc) goes last, so an mc already on PATH wins.
command -v mc >/dev/null 2>&1 || export PATH="$PATH:$HOME/.local/bin"
if ! command -v mc >/dev/null 2>&1; then
  mkdir -p "$HOME/.local/bin"
  case "$(uname -m)" in
    x86_64|amd64) MC_ARCH=amd64 ;;
    aarch64|arm64) MC_ARCH=arm64 ;;
    *) echo "synnexus sync: unsupported arch $(uname -m); install mc manually." >&2; exit 1 ;;
  esac
  echo "synnexus sync: mc not found — downloading $MC_RELEASE to ~/.local/bin/mc ..." >&2
  MC_URL="https://github.com/minio/mc/releases/download/$MC_RELEASE/mc.linux-$MC_ARCH.$MC_RELEASE"
  MC_TMP="$(mktemp -d)"
  if ! curl -fsSL "$MC_URL" -o "$MC_TMP/mc" || ! curl -fsSL "$MC_URL.sha256sum" -o "$MC_TMP/sum"; then
    rm -rf "$MC_TMP"
    echo "synnexus sync: failed to download mc from $MC_URL (offline?)." >&2
    exit 1
  fi
  if [ "$(sha256sum "$MC_TMP/mc" | awk '{print $1}')" != "$(awk '{print $1}' "$MC_TMP/sum")" ]; then
    rm -rf "$MC_TMP"
    echo "synnexus sync: mc download failed its SHA-256 check; not installed." >&2
    exit 1
  fi
  install -m 755 "$MC_TMP/mc" "$HOME/.local/bin/mc"
  rm -rf "$MC_TMP"
fi

# --- 3. ensure the mc alias (connection) + bucket ------------------------------
# Re-set the alias whenever ~/.config/synnexus.env differs from it, so rotated
# keys take effect; mc keeps them in plain text, so keep its config private.
if ! mc alias list "$MC_ALIAS" --json 2>/dev/null \
     | grep -qF "\"accessKey\":\"$SYNNEXUS_ACCESS_KEY\"" \
   || ! mc alias list "$MC_ALIAS" --json 2>/dev/null | grep -qF "\"URL\":\"$SYNNEXUS_ENDPOINT\""; then
  mc alias set "$MC_ALIAS" "$SYNNEXUS_ENDPOINT" "$SYNNEXUS_ACCESS_KEY" "$SYNNEXUS_SECRET_KEY" >/dev/null
fi
chmod 600 "$HOME/.mc/config.json" 2>/dev/null || true
mc mb --ignore-existing "$MC_ALIAS/$SYNNEXUS_BUCKET" >/dev/null 2>&1 || true

# --- 4. resolve the app slug ---------------------------------------------------
# Order: WORKITEMS_SLUG env > per-repo `git config workitems.slug` > the slug in
# _deploy/envs/<slug>-<env>.env (scaffolded apps). Repos without _deploy (e.g. the
# toolkit itself) set the slug once with `git config workitems.slug <slug>`.
SLUG="${WORKITEMS_SLUG:-}"
if [ -z "$SLUG" ]; then
  SLUG="$(git -C "$ROOT" config --get workitems.slug 2>/dev/null || true)"
fi
if [ -z "$SLUG" ]; then
  for f in "$ROOT"/_deploy/envs/*.env; do
    [ -e "$f" ] || continue
    base="$(basename "$f" .env)"
    SLUG="$(printf '%s' "$base" | sed -E 's/-(sbx|uat|prod)$//')"
    break
  done
fi
if [ -z "$SLUG" ]; then
  echo "synnexus sync: cannot determine app slug. Set it with 'git config workitems.slug <slug>' or export WORKITEMS_SLUG (scaffolded apps derive it from _deploy/envs/*.env)." >&2
  exit 2
fi

# --- 4b. pick the source: the working branch's committed copy ------------------
SRC_BRANCH="$(git -C "$ROOT" config --get workitems.branch 2>/dev/null || true)"
if [ -z "$SRC_BRANCH" ] && git -C "$ROOT" rev-parse --verify -q refs/heads/develop >/dev/null 2>&1; then
  SRC_BRANCH=develop
fi

DEST="$MC_ALIAS/$SYNNEXUS_BUCKET/product-workitems/$SLUG/features/"
# Human-facing storage path (bucket-relative; what other apps see):
STORE_PATH="$SYNNEXUS_BUCKET/product-workitems/$SLUG/features/"

# --- 5. act --------------------------------------------------------------------
case "$CMD" in
  mirror)
    SRC_DIR="$FEATURES_DIR"
    SRC_DESC="$FEATURES_DIR"
    if [ -n "$SRC_BRANCH" ]; then
      if ! git -C "$ROOT" cat-file -e "$SRC_BRANCH:_workitems/features" 2>/dev/null; then
        echo "synnexus sync: no _workitems/features on $SRC_BRANCH — nothing to mirror." >&2
        exit 0
      fi
      TMP_SRC="$(mktemp -d)"
      trap 'rm -rf "$TMP_SRC"' EXIT
      git -C "$ROOT" archive "$SRC_BRANCH" _workitems/features | tar -x -C "$TMP_SRC"
      # git archive stamps every file with the commit's time, which would make mc's
      # --overwrite re-send all of them after any commit. Give each file the time of
      # the last commit that touched it instead, so only changed files go up.
      git -C "$ROOT" -c core.quotePath=false log --format='@%ct' --name-only "$SRC_BRANCH" -- _workitems/features \
        | awk '/^@/ { t = substr($0, 2); next } NF && !seen[$0]++ { print t "\t" $0 }' \
        | while IFS="$(printf '\t')" read -r t f; do
            if [ -f "$TMP_SRC/$f" ]; then touch -d "@$t" "$TMP_SRC/$f"; fi
          done
      SRC_DIR="$TMP_SRC/_workitems/features"
      SRC_DESC="$SRC_BRANCH:_workitems/features"
    else
      echo "synnexus sync: no develop and no 'git config workitems.branch'; mirroring the checked-out folder (set workitems.branch to pin it)." >&2
      if [ ! -d "$FEATURES_DIR" ]; then
        echo "synnexus sync: no $FEATURES_DIR — nothing to mirror." >&2
        exit 0
      fi
    fi
    # local -> remote ONLY. --overwrite updates changed files; --remove prunes
    # remote objects gone from local, scoped to this slug's prefix.
    # mc prints a line per file; keep the output to one summary line.
    if ! OUT="$(mc mirror --quiet --overwrite --remove "$SRC_DIR" "$DEST" 2>&1)"; then
      printf '%s\n' "$OUT" >&2
      exit 1
    fi
    SENT="$(printf '%s\n' "$OUT" | grep -c '^`' || true)"
    REMOVED="$(printf '%s\n' "$OUT" | grep -ci '^removed' || true)"
    echo "synnexus sync: mirrored $SRC_DESC -> $STORE_PATH (bucket $SYNNEXUS_BUCKET; $SENT sent, $REMOVED removed)"
    ;;
  push)
    SRC="${2:-}"
    [ -n "$SRC" ] || { echo "usage: sync-workitems.sh push <file>" >&2; exit 2; }
    [ -f "$SRC" ] || { echo "synnexus sync: no such file: $SRC" >&2; exit 2; }
    # map <root>/_workitems/features/<rest> -> product-workitems/<slug>/features/<rest>
    abs="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"
    case "$abs" in
      "$FEATURES_DIR"/*) rel="${abs#"$FEATURES_DIR"/}" ;;
      *) echo "synnexus sync: $SRC is not under _workitems/features/" >&2; exit 2 ;;
    esac
    mc cp "$abs" "${DEST}${rel}"
    echo "synnexus sync: pushed $rel -> ${STORE_PATH}${rel} (bucket $SYNNEXUS_BUCKET)"
    ;;
  *)
    echo "usage: sync-workitems.sh [mirror|push <file>]" >&2
    exit 2
    ;;
esac
