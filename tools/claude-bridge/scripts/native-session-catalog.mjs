import path from "node:path";
import { homedir } from "node:os";
import { listNativeSessions } from "../src/native-session-catalog.mjs";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--projects-dir" || !args[1])) {
  console.error("Usage: node tools/claude-bridge/scripts/native-session-catalog.mjs [--projects-dir DIRECTORY]");
  process.exitCode = 1;
} else {
  const projectsDirectory = args[1] ?? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), "projects");
  try {
    const sessions = await listNativeSessions(projectsDirectory);
    console.log(JSON.stringify({ readOnly: true, activityDetection: "not_available", sessions }, null, 2));
    if (sessions.some(session => session.error)) process.exitCode = 2;
  } catch {
    // Filesystem exception messages may contain private paths. Do not print them.
    console.error("CATALOG_UNAVAILABLE");
    process.exitCode = 1;
  }
}
