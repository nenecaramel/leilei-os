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

require_mac_safe_worktree() {
  # NUL-delimited porcelain keeps whitespace/newlines literal. Check both
  # sides of a rename so moving runtime code into ios/ cannot bypass the guard.
  node --input-type=commonjs <<'NODE'
const { spawnSync } = require('node:child_process');
const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
if (result.error || result.status !== 0) {
  console.error('[mac-daemon:fresh] could not inspect local changes; refusing restart');
  process.exit(1);
}
const records = result.stdout.split('\0').filter(Boolean);
const blocked = [];
let allowed = 0;
for (let i = 0; i < records.length; i++) {
  const status = records[i].slice(0, 2);
  const paths = [records[i].slice(3)];
  if (/[RC]/u.test(status)) paths.push(records[++i] ?? '');
  if (status.includes('U') || status === 'AA' || status === 'DD' || paths.some(path => !path.startsWith('ios/'))) {
    blocked.push(...paths);
  } else allowed++;
}
if (blocked.length) {
  console.error('[mac-daemon:fresh] dirty paths outside ios/ or unresolved conflicts: ' + blocked.map(path => JSON.stringify(path)).join(', '));
  console.error('[mac-daemon:fresh] preserve/commit local changes first; no autostash or reset is performed');
  process.exit(1);
}
if (allowed) console.log('[mac-daemon:fresh] preserving ' + allowed + ' dirty iOS path(s) unchanged');
NODE
}
require_mac_safe_worktree

echo "[mac-daemon:fresh] branch: $current_branch"
if [[ "$allow_current" == true ]]; then
  echo "[mac-daemon:fresh] explicit development mode: starting current HEAD without fetch/rebase"
else
  echo "[mac-daemon:fresh] fetching origin/main..."
  git fetch origin main
  require_mac_safe_worktree
  if ! git merge-base --is-ancestor HEAD origin/main; then
    echo "[mac-daemon:fresh] main has unpublished or divergent commits; reconcile manually before normal fresh" >&2
    exit 1
  fi
  git -c merge.autostash=false merge --ff-only origin/main
  require_mac_safe_worktree
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
