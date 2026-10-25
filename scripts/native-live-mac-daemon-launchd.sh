#!/usr/bin/env bash
# Keep the Mac daemon running under launchd: started at login, restarted after
# a crash, logs under ~/.leileios/logs. Only the canonical checkout is supported.
set -euo pipefail

label="com.leileios.native-live-mac-daemon"
usage="usage: launchd install|uninstall|start|stop|restart|status"
command="${1:-}"
if [[ "$#" -ne 1 ]]; then echo "[mac-daemon:launchd] $usage" >&2; exit 1; fi
case "$command" in
  install|uninstall|start|stop|restart|status) ;;
  *) echo "[mac-daemon:launchd] $usage" >&2; exit 1 ;;
esac

if [[ "$(uname -s)" != Darwin ]]; then
  echo "[mac-daemon:launchd] launchd supervision is only available on macOS" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root"
canonical_root="$HOME/Developer/leilei-os-main"
domain="gui/$(id -u)"
service="$domain/$label"
plist="$HOME/Library/LaunchAgents/$label.plist"
log_dir="$HOME/.leileios/logs"
daemon_pattern='^([^[:space:]]*/)?(node|tsx)([[:space:]]|$).*scripts/native-live-mac-daemon[.]ts([[:space:]]|$)'

loaded() { launchctl print "$service" >/dev/null 2>&1; }

require_canonical() {
  if [[ ! -d "$canonical_root" || "$repo_root" != "$(cd "$canonical_root" && pwd -P)" ]]; then
    echo "[mac-daemon:launchd] launchd supervision requires the canonical ~/Developer/leilei-os-main copy" >&2
    exit 1
  fi
}

# sed rather than ${var//}: bash 5.2 treats & in a replacement as the match.
xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

write_plist() {
  local node_dir="$1" path_value
  path_value="$node_dir:$PATH"
  mkdir -p "$(dirname "$plist")" "$log_dir"
  cat > "$plist.tmp" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$repo_root/scripts/native-live-mac-daemon-supervised.sh")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$repo_root")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml_escape "$path_value")</string>
    <key>HOME</key><string>$(xml_escape "$HOME")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>StandardOutPath</key><string>$(xml_escape "$log_dir/native-live-daemon-launchd.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$log_dir/native-live-daemon-launchd.log")</string>
</dict>
</plist>
PLIST
  mv -f "$plist.tmp" "$plist"
}

stop_foreground_daemon() {
  if pgrep -f "$daemon_pattern" >/dev/null 2>&1; then
    echo "[mac-daemon:launchd] stopping the daemon started from a terminal..."
    pkill -f "$daemon_pattern" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pgrep -f "$daemon_pattern" >/dev/null 2>&1 || return 0
      sleep 1
    done
    echo "[mac-daemon:launchd] the terminal daemon did not exit; stop it and retry" >&2
    exit 1
  fi
}

case "$command" in
  install)
    require_canonical
    node_version="$(node --version 2>/dev/null || true)"
    if [[ "$node_version" != v24.* ]]; then
      echo "[mac-daemon:launchd] Node 24 is required (found ${node_version:-none}); select Node 24 in PATH before installing" >&2
      exit 1
    fi
    if [[ ! -f "$repo_root/node_modules/tsx/dist/cli.mjs" ]]; then
      echo "[mac-daemon:launchd] dependencies are missing; run pnpm install first" >&2
      exit 1
    fi
    node_dir="$(dirname "$(command -v node)")"
    # Check configuration exactly as launchd will see it: no shell profile.
    if ! env -i HOME="$HOME" PATH="$node_dir:$PATH" \
      node "$repo_root/node_modules/tsx/dist/cli.mjs" \
      "$repo_root/scripts/native-live-mac-daemon-check-config.ts"; then
      echo "[mac-daemon:launchd] move the daemon variables into $repo_root/.env, then retry" >&2
      exit 1
    fi
    if loaded; then launchctl bootout "$service" 2>/dev/null || true; fi
    stop_foreground_daemon
    write_plist "$node_dir"
    rm -f "$HOME/.leileios/supervisor/quick-failures"
    launchctl bootstrap "$domain" "$plist"
    echo "[mac-daemon:launchd] installed; the daemon now starts at login and restarts after a crash"
    echo "[mac-daemon:launchd] logs: $log_dir/native-live-daemon.log"
    ;;
  uninstall)
    if loaded; then launchctl bootout "$service"; fi
    rm -f "$plist"
    echo "[mac-daemon:launchd] uninstalled; start the daemon from a terminal with pnpm runtime:native-live-mac-daemon:fresh"
    ;;
  start)
    if [[ ! -f "$plist" ]]; then echo "[mac-daemon:launchd] not installed; run install first" >&2; exit 1; fi
    require_canonical
    if loaded; then echo "[mac-daemon:launchd] already running under launchd"; exit 0; fi
    stop_foreground_daemon
    rm -f "$HOME/.leileios/supervisor/quick-failures"
    launchctl bootstrap "$domain" "$plist"
    echo "[mac-daemon:launchd] started"
    ;;
  stop)
    if loaded; then launchctl bootout "$service"; fi
    echo "[mac-daemon:launchd] stopped until the next login or start"
    ;;
  restart)
    if ! loaded; then echo "[mac-daemon:launchd] not running under launchd; use start" >&2; exit 1; fi
    rm -f "$HOME/.leileios/supervisor/quick-failures"
    launchctl kickstart -k "$service"
    echo "[mac-daemon:launchd] restarted"
    ;;
  status)
    if [[ ! -f "$plist" ]]; then echo "[mac-daemon:launchd] not installed"; exit 0; fi
    if loaded; then
      launchctl print "$service" | grep -E '^[[:space:]]*(state|pid|last exit code|runs) =' || true
    else
      echo "[mac-daemon:launchd] installed but not loaded (stopped)"
    fi
    tail -n 5 "$log_dir/native-live-daemon-supervisor.log" 2>/dev/null || true
    ;;
esac
