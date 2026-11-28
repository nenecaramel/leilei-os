import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const defaultHome = () => process.env.LEILEI_MIND_HOME || join(homedir(), ".claude", "leileios-mind");
const pausedPath = home => join(home, "disabled");
// Off unless this file exists. It only adds a local comparison record; recall is unchanged.
const comparisonPath = home => join(home, "compare");
// On unless this file exists. Off sends every recall the old way, straight to the server.
const localOffPath = home => join(home, "local-off");

async function exists(path) {
  try {
    await fs.lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function setMarker(path, present, content) {
  if (present) {
    await fs.mkdir(dirname(path), {recursive: true, mode: 0o700});
    try {
      await fs.writeFile(path, content, {flag: "wx", mode: 0o600});
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  } else {
    try {
      await fs.unlink(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export const isMindComparisonOn = (home = defaultHome()) => exists(comparisonPath(home));

export async function setMindComparison(on, home = defaultHome()) {
  await setMarker(comparisonPath(home), on, "on\n");
  return isMindComparisonOn(home);
}

export const isMindLocalRecallOn = async (home = defaultHome()) => !await exists(localOffPath(home));

export async function setMindLocalRecall(on, home = defaultHome()) {
  await setMarker(localOffPath(home), !on, "off\n");
  return isMindLocalRecallOn(home);
}

// Failure to inspect the local switch must not accidentally wake Railway, so it throws.
export const isMindHookPaused = async (home = defaultHome()) => exists(pausedPath(home));

export async function setMindHookPaused(paused, home = defaultHome()) {
  await setMarker(pausedPath(home), paused, "paused\n");
  return isMindHookPaused(home);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2];
  try {
    if (action === "off" || action === "on") {
      await setMindHookPaused(action === "off");
    } else if (action === "compare-on" || action === "compare-off") {
      await setMindComparison(action === "compare-on");
    } else if (action === "local-on" || action === "local-off") {
      await setMindLocalRecall(action === "local-on");
    } else if (action !== "status") {
      throw new Error("Usage: node ~/.claude/leileios-mind/toggle.mjs on|off|local-on|local-off|compare-on|compare-off|status");
    }
    console.log(await isMindHookPaused()
      ? "Mind Hook OFF: Claude will not request LeileiOS memory."
      : "Mind Hook ON: Claude can request LeileiOS memory.");
    console.log(await isMindLocalRecallOn()
      ? "Local recall ON: the Mac chooses, the server checks and signs; old path when unavailable."
      : "Local recall OFF: every recall goes straight to the server.");
    console.log(await isMindComparisonOn()
      ? "Comparison ON: finished recalls are also scored locally and logged on this Mac."
      : "Comparison OFF.");
  } catch (error) {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  }
}
