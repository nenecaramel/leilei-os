#!/usr/bin/env bash
set -euo pipefail

allow_current=false
case "${1:-}" in
  "") ;;
  --current) allow_current=true ;;
  *) echo "[mac-daemon:fresh] usage: fresh [--current]" >&2; exit 1 ;;
esac
if [[ "$#" -gt 1 ]]; then
  echo "[mac-daemon:fresh] unexpected arguments" >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "[mac-daemon:fresh] not inside a git repository" >&2
  exit 1
fi
cd "$repo_root"
repo_root="$(pwd -P)"
current_branch="$(git branch --show-current)"
if [[ -z "$current_branch" ]]; then
  echo "[mac-daemon:fresh] detached HEAD is not supported" >&2
  exit 1
fi

if [[ "$allow_current" == false ]]; then
  canonical_root="$HOME/Developer/leilei-os-main"
  if [[ ! -d "$canonical_root" || "$repo_root" != "$(cd "$canonical_root" && pwd -P)" ]]; then
    echo "[mac-daemon:fresh] normal fresh requires the canonical ~/Developer/leilei-os-main copy; use fresh-current for development" >&2
    exit 1
  fi
  if [[ "$current_branch" != main ]]; then
    echo "[mac-daemon:fresh] normal fresh requires main; use runtime:native-live-mac-daemon:fresh-current explicitly for a feature branch" >&2
    exit 1
  fi
fi

for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
  if [[ -e "$(git rev-parse --git-path "$state")" ]]; then
    echo "[mac-daemon:fresh] a Git operation is in progress; resolve it first" >&2
    exit 1
  fi
done

require_clean() {
  local status_output
  if ! status_output="$(git status --porcelain --untracked-files=all)"; then
    echo "[mac-daemon:fresh] could not inspect local changes; refusing restart" >&2
    exit 1
  fi
  if [[ -n "$status_output" ]]; then
    echo "[mac-daemon:fresh] dirty worktree: commit or deliberately preserve local changes first; no autostash or reset is performed" >&2
    exit 1
  fi
}
require_clean

echo "[mac-daemon:fresh] branch: $current_branch"
if [[ "$allow_current" == true ]]; then
  echo "[mac-daemon:fresh] explicit development mode: starting current HEAD without fetch/rebase"
else
  echo "[mac-daemon:fresh] fetching origin/main..."
  git fetch origin main
  require_clean
  if ! git merge-base --is-ancestor HEAD origin/main; then
    echo "[mac-daemon:fresh] main has unpublished or divergent commits; reconcile manually before normal fresh" >&2
    exit 1
  fi
  git merge --ff-only origin/main
  require_clean
fi

echo "[mac-daemon:fresh] starting from: $(git rev-parse --short HEAD)"

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
