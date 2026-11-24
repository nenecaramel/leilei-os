// Tools the owner does not want in a Native Live SDK session (2026-11-25).
// This narrows only what this SDK session can see. The LeileiOS server still
// registers every tool for Desktop, the public connector and other clients.
// Remove a line to give a tool back.
const apple = [
  "contacts", "files", "finder", "keynote", "mail", "messages", "music", "numbers", "pages",
  "photos", "reminders", "safari", "shortcuts", "system", "textedit",
].map((app) => `mcp__apple-productivity-local__apple_${app}_*`); // keeps notes, calendar

const peekaboo = [
  "action", "agent", "analyze", "app", "browser", "capture", "click", "clipboard", "dialog", "dock",
  "drag", "inspect_ui", "menu", "paste", "press", "scroll", "select_text", "set_value", "sleep",
  "space", "type", "verify_state", "window",
].map((name) => `mcp__peekaboo__${name}`); // keeps image, see, permissions

const leileios = [
  "create_universe_node", "update_universe_node",
  "create_universe_relation", "update_universe_relation", "delete_universe_relation",
  "add_universe_diary_source", "delete_universe_diary_source",
  "update_diary_comment", "delete_diary_comment",
  "replace_todo_paper",
].map((name) => `mcp__leileios__${name}`);

const builtin = [
  "EnterWorktree", "ExitWorktree", "EnterPlanMode", "ExitPlanMode",
  "NotebookEdit", "DesignSync", "RemoteTrigger", "SendMessage",
];

export const SDK_DISALLOWED_TOOLS = Object.freeze([
  ...apple,
  ...peekaboo,
  ...leileios,
  "mcp__claude-in-chrome",
  // Duplicates the internal leileios server and would bypass the list above.
  "mcp__claude_ai_leileios",
  ...builtin,
]);
