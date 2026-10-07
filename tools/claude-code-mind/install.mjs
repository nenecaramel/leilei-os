import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export function configureHooks(settings, {home, serverName = "leileios", nodeCommand = "node"}) {
  if (!/^[A-Za-z0-9_-]+$/.test(serverName)) throw new Error("Specify the actual registered MCP server name.");
  const hook = join(home, "hook.mjs");
  const command = `LEILEI_MIND_HOME=${quote(home)} ${quote(nodeCommand)} ${quote(hook)}`;
  const hooks = {...settings.hooks};
  const definition = {type: "command", command, timeout: 5};
  for (const event of ["UserPromptSubmit", "SessionStart", "PostToolUse", "Stop"]) {
    const items = hooks[event] ?? [];
    if (!Array.isArray(items)) throw new Error("Invalid existing hooks.");
    // Replace only this installation's exact script; preserve all unrelated hook entries.
    hooks[event] = items.flatMap(item => {
      if (!Array.isArray(item.hooks)) throw new Error("Invalid existing hook entry.");
      const remaining = item.hooks.filter(h => !(h.type === "command" && h.command?.includes(quote(hook))));
      return remaining.length ? [{...item, hooks: remaining}] : [];
    });
    hooks[event].push({
      ...(event === "SessionStart" ? {matcher: "startup|resume|compact|clear|fork"} : {}),
      ...(event === "PostToolUse" ? {matcher: `^mcp__${serverName}__write_memory$`} : {}),
      hooks: [definition],
    });
  }
  return {...settings, hooks};
}

export async function install({claudeHome = join(homedir(), ".claude"), serverName = "leileios", nodeCommand = "node"}) {
  const home = join(claudeHome, "leileios-mind");
  await fs.mkdir(home, {recursive: true, mode: 0o700});
  await fs.chmod(home, 0o700);
  const settingsPath = join(claudeHome, "settings.json");
  let settings;
  try { settings = JSON.parse(await fs.readFile(settingsPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; settings = {}; }
  const next = configureHooks(settings, {home, serverName, nodeCommand});
  const source = join(dirname(fileURLToPath(import.meta.url)), "hook.mjs");
  // Install the dependency before publishing a hook that imports it.
  await fs.copyFile(join(dirname(source), "transcript.mjs"), join(home, "transcript.mjs"));
  await fs.chmod(join(home, "transcript.mjs"), 0o600);
  await fs.copyFile(source, join(home, "hook.mjs"));
  await fs.chmod(join(home, "hook.mjs"), 0o600);
  const temporary = `${settingsPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(next, null, 2) + "\n", {mode: 0o600, flag: "wx"});
    await fs.rename(temporary, settingsPath);
  } finally { await fs.unlink(temporary).catch(() => undefined); }
  return home;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const serverName = process.argv[2] || "leileios";
  if (!serverName) { console.error("Usage: node tools/claude-code-mind/install.mjs <actual-MCP-server-name>"); process.exitCode = 1; }
  else console.log(`Hooks installed in ${await install({serverName})}. Configure the private mind.env before recall can connect.`);
}
