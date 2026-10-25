import "dotenv/config";
import {
  resolveNativeLiveMacDaemonConfig,
} from "../src/domains/bridge/mac/native-live-mac-daemon-config.js";

// launchd starts the daemon without the owner's shell profile. The installer
// runs this under the same minimal environment so missing configuration fails
// at install time instead of as a silent restart loop. Never print values.
try {
  resolveNativeLiveMacDaemonConfig(process.env);
  if (process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY must be unset; native live uses Claude Code subscription auth.",
    );
  }
  console.log("[mac-daemon:launchd] daemon configuration resolves without a shell profile");
} catch (error) {
  console.error(
    "[mac-daemon:launchd] daemon configuration is incomplete without a shell profile: "
      + (error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
}
