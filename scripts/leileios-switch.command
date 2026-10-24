#!/bin/bash
set -eu
mode="${1:-}"
case "$mode" in
  desktop|leileios|list) ;;
  *) echo '用法：bash ~/Documents/Codex/leileios-switch.command desktop|leileios|list [session-id]' >&2; exit 1 ;;
esac
if [ "$#" -gt 2 ]; then echo '最多指定一个 session-id' >&2; exit 1; fi
# Finder launches .command files with a minimal PATH; prefer the pinned
# Homebrew Node 22 and fall back to whichever node is on PATH.
node_bin=/opt/homebrew/opt/node@22/bin/node
if [ ! -x "$node_bin" ]; then
  node_bin="$(command -v node || true)"
  if [ -z "$node_bin" ]; then echo '未找到 node；请安装 Node 22。' >&2; exit 1; fi
fi
for repo in "$HOME/Developer/leilei-os-main"; do
  if [ -f "$repo/scripts/native-session-pick.mjs" ]; then
    if [ "$mode" = list ]; then
      exec "$node_bin" "$repo/scripts/native-session-local.mjs" list
    elif [ "$#" -eq 2 ]; then
      exec "$node_bin" "$repo/scripts/native-session-local.mjs" "$mode" "$2"
    else
      exec "$node_bin" "$repo/scripts/native-session-pick.mjs" "$mode"
    fi
  fi
done
echo '正式目录尚未更新到支持对话选择的版本；未执行交接。' >&2
exit 1
