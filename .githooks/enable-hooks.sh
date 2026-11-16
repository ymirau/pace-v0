#!/bin/sh
# enable-hooks.sh — switch on this repo's versioned hooks (.githooks/) for this clone.
#
#   sh .githooks/enable-hooks.sh [dir]     dir: anywhere inside the repo (default .)
#
# Git never turns on a repo's hooks by itself, so every clone needs
# `git config core.hooksPath .githooks` once. This does it for the developer, from
# steps they take anyway: frontend/package.json's `prepare` (every npm install / npm
# ci), /syn-start-local-servers and the toolkit's workitems-commit.sh.
#
# Sets it only when core.hooksPath is unset. Leaves alone: a clone that already has it
# (or points it somewhere else, e.g. .husky), a clone with active hooks of its own in
# .git/hooks (switching would turn them off), CI (CI is set), and anything that isn't a
# git checkout with a .githooks/ folder. Prints one line when it switches the hooks on,
# nothing otherwise, and always exits 0, so it can never fail an install.

[ -z "${CI:-}" ] || exit 0
cd "${1:-.}" 2>/dev/null || exit 0
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -d "$top/.githooks" ] || exit 0
[ -z "$(git -C "$top" config --get core.hooksPath)" ] || exit 0

hooks=$(git -C "$top" rev-parse --git-path hooks 2>/dev/null) || exit 0
case $hooks in /*) ;; *) hooks="$top/$hooks" ;; esac
[ -z "$(find "$hooks" -maxdepth 1 -type f -perm -u+x ! -name '*.sample' 2>/dev/null)" ] || exit 0

git -C "$top" config core.hooksPath .githooks 2>/dev/null &&
  echo "hooks: switched on .githooks for this clone (blocks commits on main/uat/develop; syncs the backlog on push)"
exit 0
