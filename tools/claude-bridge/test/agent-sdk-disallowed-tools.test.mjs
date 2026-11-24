import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { SDK_DISALLOWED_TOOLS } from "../src/agent-sdk-disallowed-tools.mjs";
import { AgentSdkClaudeTransport } from "../src/agent-sdk-claude-transport.mjs";

const matches = (rule, name) => rule.endsWith("*")
  ? name.startsWith(rule.slice(0, -1))
  : rule === name || (/^mcp__[^_]+(?:[-_][^_]+)*$/u.test(rule) && name.startsWith(`${rule}__`));
const denied = name => SDK_DISALLOWED_TOOLS.some(rule => matches(rule, name));
const mcp = (server, names) => names.map(name => `mcp__${server}__${name}`);

test("the owner's keep list survives", () => {
  for (const name of [
    ...mcp("apple-productivity-local", ["apple_notes_list", "apple_notes_create", "apple_calendar_create_event", "apple_calendar_list_events"]),
    ...mcp("peekaboo", ["image", "see", "permissions"]),
    ...mcp("leileios", [
      "toy_set", "toy_stop", "write_memory", "search_memory", "get_memory", "read_memory_day", "update_memory",
      "create_diary", "update_diary", "get_diary", "search_diary", "add_diary_comment", "list_diary_comments", "get_diary_comment",
      "read_todo_day", "list_todo_dates", "search_todo", "append_todo_entry", "append_todo_entries", "update_todo_entry", "delete_todo_entry",
      "get_universe_node", "list_universe_nodes", "list_universe_galaxies", "get_universe_relations", "get_universe_diary_sources",
      "get_health", "get_current_time", "global_search",
    ]),
    "mcp__leileios_local__send_file", "SendUserFile", "Bash", "Read", "Edit", "Write", "Skill", "ToolSearch",
    "WebSearch", "WebFetch", "CronCreate", "CronDelete", "CronList", "AskUserQuestion",
  ]) assert.equal(denied(name), false, name);
});

test("the tools the owner cut are denied", () => {
  for (const name of [
    ...mcp("apple-productivity-local", [
      "apple_contacts_search", "apple_files_list", "apple_finder_reveal", "apple_keynote_create", "apple_mail_send",
      "apple_messages_send", "apple_music_playback", "apple_numbers_create", "apple_pages_create", "apple_photos_list",
      "apple_reminders_create", "apple_safari_open_tab", "apple_shortcuts_list", "apple_system_open_app", "apple_textedit_create",
    ]),
    ...mcp("peekaboo", ["action", "agent", "click", "type", "clipboard", "browser", "window"]),
    ...mcp("leileios", [
      "create_universe_node", "update_universe_node", "create_universe_relation", "update_universe_relation", "delete_universe_relation",
      "add_universe_diary_source", "delete_universe_diary_source", "update_diary_comment", "delete_diary_comment", "replace_todo_paper",
    ]),
    "mcp__claude-in-chrome__navigate",
    // The claude.ai connector duplicates the internal server and would bypass the cuts above.
    "mcp__claude_ai_leileios__create_universe_node", "mcp__claude_ai_leileios__write_memory",
    "EnterWorktree", "ExitWorktree", "EnterPlanMode", "ExitPlanMode", "NotebookEdit", "DesignSync", "RemoteTrigger", "SendMessage",
  ]) assert.equal(denied(name), true, name);
});

test("a turn starts the SDK with the disallowed list", async () => {
  let options;
  const transport = new AgentSdkClaudeTransport({ environment: {}, queryImpl: input => {
    options = input.options;
    throw new Error("captured");
  } });
  await transport.executeTurn("hi", { mode: "new", parentProviderSessionId: null, streaming: true }).catch(() => {});
  assert.deepEqual(options.disallowedTools, [...SDK_DISALLOWED_TOOLS]);
});

test("every SDK options site carries the list", () => {
  for (const file of ["agent-sdk-claude-transport", "agent-sdk-persistent-session", "agent-sdk-foreground-execution"]) {
    assert.match(fs.readFileSync(new URL(`../src/${file}.mjs`, import.meta.url), "utf8"), /disallowedTools: \[\.\.\.SDK_DISALLOWED_TOOLS\]/u, file);
  }
});
