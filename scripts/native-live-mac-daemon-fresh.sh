#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "[mac-daemon:fresh] not inside a git repository" >&2
  exit 1
fi

cd "$repo_root"

current_branch="$(git branch --show-current)"
if [[ -z "$current_branch" ]]; then
  echo "[mac-daemon:fresh] detached HEAD is not supported" >&2
  exit 1
fi

if [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]; then
  echo "[mac-daemon:fresh] a rebase is already in progress; resolve or abort it first" >&2
  exit 1
fi

echo "[mac-daemon:fresh] branch: $current_branch"
echo "[mac-daemon:fresh] fetching origin..."
git fetch --prune origin

echo "[mac-daemon:fresh] rebasing current branch onto origin/main with autostash..."
git rebase --autostash origin/main

if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "[mac-daemon:fresh] origin/main is not an ancestor of HEAD after rebase" >&2
  exit 1
fi

if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  echo "[mac-daemon:fresh] unresolved merge conflicts remain; daemon was not restarted" >&2
  git status --short
  exit 1
fi

echo "[mac-daemon:fresh] synced: $(git rev-parse --short HEAD)"
echo "[mac-daemon:fresh] main:   $(git rev-parse --short origin/main)"

daemon_pattern='tsx scripts/native-live-mac-daemon.ts'

echo "[mac-daemon:fresh] stopping old Mac daemon..."
pkill -f "$daemon_pattern" 2>/dev/null || true
sleep 1

if pgrep -f "$daemon_pattern" >/dev/null 2>&1; then
  echo "[mac-daemon:fresh] old daemon did not exit; forcing it down..."
  pkill -9 -f "$daemon_pattern" 2>/dev/null || true
  sleep 1
fi

if pgrep -f "$daemon_pattern" >/dev/null 2>&1; then
  echo "[mac-daemon:fresh] failed to stop the old daemon" >&2
  exit 1
fi

echo "[mac-daemon:fresh] starting Mac daemon..."
exec pnpm runtime:native-live-mac-daemon
