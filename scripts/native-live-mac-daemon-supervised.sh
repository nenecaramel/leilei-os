#!/usr/bin/env bash
# launchd entry point for the Mac daemon; install it with
# scripts/native-live-mac-daemon-launchd.sh. launchd restarts this job after a
# nonzero exit; this wrapper adds crash backoff, log rotation and exit records.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root" || exit 78
state_dir="$HOME/.leileios/supervisor"
log_dir="$HOME/.leileios/logs"
mkdir -p "$state_dir" "$log_dir" || exit 78
failures_file="$state_dir/quick-failures"
daemon_log="$log_dir/native-live-daemon.log"
supervisor_log="$log_dir/native-live-daemon-supervisor.log"
stable_seconds="${LEILEIOS_SUPERVISOR_STABLE_SECONDS:-120}"
log_max_bytes=$((10 * 1024 * 1024))

record() {
  printf '{"at":"%s","outcome":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-}" >> "$supervisor_log"
}

for log in "$daemon_log" "$supervisor_log"; do
  if [[ -f "$log" && "$(wc -c < "$log")" -gt "$log_max_bytes" ]]; then
    mv -f "$log" "$log.1"
  fi
done
exec >> "$daemon_log" 2>&1

failures="$(cat "$failures_file" 2>/dev/null || true)"
[[ "$failures" =~ ^[0-9]+$ ]] || failures=0

child=""
stopping=false
on_signal() {
  stopping=true
  if [[ -n "$child" ]]; then kill -TERM "$child" 2>/dev/null || true; fi
}
trap on_signal TERM INT

if (( failures > 0 )); then
  exponent=$(( failures > 6 ? 5 : failures - 1 ))
  delay=$(( 10 * (1 << exponent) ))
  (( delay > 300 )) && delay=300
  record backoff ",\"quickFailures\":$failures,\"delaySeconds\":$delay"
  sleep "$delay" &
  child=$!
  wait "$child"
  child=""
  if [[ "$stopping" == true ]]; then
    record stopped_during_backoff
    exit 0
  fi
fi

node_version="$(node --version 2>/dev/null || true)"
if [[ "$node_version" != v22.* ]]; then
  echo $((failures + 1)) > "$failures_file"
  record node_unavailable ",\"found\":\"${node_version:-none}\""
  exit 78
fi

started="$(date +%s)"
record started ",\"head\":\"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)\""
node "$repo_root/node_modules/tsx/dist/cli.mjs" scripts/native-live-mac-daemon.ts &
child=$!
status=0
wait "$child" || status=$?
# A trapped signal interrupts wait; keep waiting for the daemon to finish its
# graceful shutdown instead of leaving it behind.
while kill -0 "$child" 2>/dev/null; do
  status=0
  wait "$child" || status=$?
done
ran=$(( $(date +%s) - started ))

if [[ "$stopping" == true ]]; then
  rm -f "$failures_file"
  record stopped ",\"status\":$status,\"ranSeconds\":$ran"
  exit 0
fi
if (( status != 0 && ran < stable_seconds )); then
  echo $((failures + 1)) > "$failures_file"
else
  rm -f "$failures_file"
fi
record exited ",\"status\":$status,\"ranSeconds\":$ran"
exit "$status"
