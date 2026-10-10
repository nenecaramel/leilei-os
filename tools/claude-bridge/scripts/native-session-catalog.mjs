import path from "node:path";
import { homedir } from "node:os";
import { listNativeSessions } from "../src/native-session-catalog.mjs";
import { listDesktopNativeSessions } from "../src/native-session-inspection.mjs";

const args = process.argv.slice(2);
const flags = new Map();
const valuedFlags = new Set(["--projects-dir", "--desktop-dir", "--peer-dir"]);
let valid = true;
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flags.has(flag)) { valid = false; break; }
  if (flag === "--desktop") flags.set(flag, true);
  else if (valuedFlags.has(flag) && args[i + 1] && !args[i + 1].startsWith("--")) flags.set(flag, args[++i]);
  else { valid = false; break; }
}
if (!flags.has("--desktop") && (flags.has("--desktop-dir") || flags.has("--peer-dir"))) valid = false;
if (!valid) {
  console.error("Usage: native-session-catalog.mjs [--projects-dir DIRECTORY] [--desktop [--desktop-dir DIRECTORY] [--peer-dir DIRECTORY]]");
  process.exitCode = 1;
} else {
  const configDirectory = process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude");
  const projectsDirectory = flags.get("--projects-dir") ?? path.join(configDirectory, "projects");
  try {
    const result = flags.has("--desktop")
      ? await listDesktopNativeSessions({
          desktopSessionsDirectory: flags.get("--desktop-dir") ?? path.join(homedir(), "Library", "Application Support", "Claude", "claude-code-sessions"),
          projectsDirectory, peerDirectory: flags.get("--peer-dir") ?? path.join(configDirectory, "sessions"),
        })
      : { readOnly: true, activityDetection: "not_available", sessions: await listNativeSessions(projectsDirectory) };
    console.log(JSON.stringify(result, null, 2));
    if (result.sessions.some(session => session.error || session.history?.state === "unavailable")) process.exitCode = 2;
  } catch {
    // Filesystem exception messages may contain private paths. Do not print them.
    console.error("CATALOG_UNAVAILABLE");
    process.exitCode = 1;
  }
}
