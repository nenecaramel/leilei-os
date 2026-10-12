import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const defaultHome = () => process.env.LEILEI_MIND_HOME || join(homedir(), ".claude", "leileios-mind");
const pausedPath = home => join(home, "disabled");

export async function isMindHookPaused(home = defaultHome()) {
  try {
    await fs.lstat(pausedPath(home));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    // Failure to inspect the local switch must not accidentally wake Railway.
    throw error;
  }
}

export async function setMindHookPaused(paused, home = defaultHome()) {
  if (paused) {
    await fs.mkdir(home, {recursive: true, mode: 0o700});
    try {
      await fs.writeFile(pausedPath(home), "paused\n", {flag: "wx", mode: 0o600});
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  } else {
    try {
      await fs.unlink(pausedPath(home));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return isMindHookPaused(home);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2];
  try {
    if (action === "off" || action === "on") {
      await setMindHookPaused(action === "off");
    } else if (action !== "status") {
      throw new Error("Usage: node ~/.claude/leileios-mind/toggle.mjs on|off|status");
    }
    console.log(await isMindHookPaused()
      ? "Mind Hook OFF: Claude will not request LeileiOS memory."
      : "Mind Hook ON: Claude can request LeileiOS memory.");
  } catch (error) {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  }
}
