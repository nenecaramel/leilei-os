import path from "node:path";
import { homedir } from "node:os";
import { inspectDesktopNativeSession, nativeInspectionErrorCode } from "../src/native-session-inspection.mjs";

const args = process.argv.slice(2);
const flags = new Map();
const allowed = new Set(["--desktop-index", "--project-dir", "--peer-dir"]);
let valid = args.length % 2 === 0;
for (let i = 0; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) valid = false;
  flags.set(args[i], args[i + 1]);
}
if (!valid || !flags.has("--desktop-index") || !flags.has("--project-dir")) {
  console.error("Usage: native-session-inspect.mjs --desktop-index FILE --project-dir DIRECTORY [--peer-dir DIRECTORY]");
  process.exitCode = 1;
} else {
  try {
    const result = await inspectDesktopNativeSession({
      indexFile: flags.get("--desktop-index"), projectDirectory: flags.get("--project-dir"),
      peerDirectory: flags.get("--peer-dir") ?? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), "sessions"),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.history.state !== "complete") process.exitCode = 2;
  } catch (error) {
    // No filesystem messages, private paths, transcripts or Desktop config.
    console.error(nativeInspectionErrorCode(error));
    process.exitCode = 1;
  }
}
