#!/bin/bash
set -eu
mode="${1:-}"
case "$mode" in
  desktop|leileios|list)
    if [ "$#" -gt 2 ]; then echo '最多指定一个 session-id' >&2; exit 1; fi ;;
  desktop-light)
    if [ "$#" -ne 3 ]; then echo '用法：desktop-light SESSION_ID CONVERSATION_ID' >&2; exit 1; fi ;;
  leileios-light)
    if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then echo '用法：leileios-light SESSION_ID [CONVERSATION_ID]' >&2; exit 1; fi ;;
  *) echo '用法：desktop|leileios|list|desktop-light|leileios-light' >&2; exit 1 ;;
esac
for repo in "$HOME/Developer/leilei-os-main"; do
  if [ -f "$repo/scripts/native-session-pick.mjs" ]; then
    if [ "$mode" = desktop-light ] || [ "$mode" = leileios-light ]; then
      exec /opt/homebrew/opt/node@22/bin/node "$repo/scripts/native-session-local.mjs" "$@"
    elif [ "$mode" = list ]; then
      exec /opt/homebrew/opt/node@22/bin/node "$repo/scripts/native-session-local.mjs" list
    elif [ "$#" -eq 2 ]; then
      exec /opt/homebrew/opt/node@22/bin/node "$repo/scripts/native-session-local.mjs" "$mode" "$2"
    else
      exec /opt/homebrew/opt/node@22/bin/node "$repo/scripts/native-session-pick.mjs" "$mode"
    fi
  fi
done
echo '正式目录尚未更新到支持对话选择的版本；未执行交接。' >&2
exit 1
