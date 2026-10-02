import "dotenv/config";
import {
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import {
  resolveNativeLiveMacWorkspaceRegistryPath,
} from "../src/domains/bridge/mac/native-live-mac-daemon-config.js";
import {
  loadNativeLiveMacWorkspaceRegistry,
  removeNativeLiveMacWorkspaceRegistryEntry,
  setNativeLiveMacWorkspaceRegistryEntry,
} from "../src/domains/bridge/mac/native-live-mac-workspace-registry.js";
import {
  pickNativeLiveMacWorkspaceRoot,
} from "../src/domains/bridge/mac/native-live-mac-workspace-picker.js";

const registryPath =
  resolveNativeLiveMacWorkspaceRegistryPath(
    process.env,
    { homedir },
  );

const [command, workspaceId, workspaceRoot, ...extra] =
  process.argv.slice(2);

if (extra.length > 0) usage();

if (command === "list") {
  if (workspaceId !== undefined || workspaceRoot !== undefined) usage();
  print({
    registryPath,
    workspaces: loadNativeLiveMacWorkspaceRegistry(registryPath),
  });
} else if (command === "pick") {
  if (!workspaceId || workspaceRoot !== undefined) usage();
  const pickedRoot = pickNativeLiveMacWorkspaceRoot();
  if (pickedRoot === null) {
    print({
      outcome: "cancelled",
      registryPath,
      workspaceId,
    });
  } else {
    const canonicalRoot = canonicalWorkspaceRoot(pickedRoot);
    const workspaces = setNativeLiveMacWorkspaceRegistryEntry(
      registryPath,
      workspaceId,
      canonicalRoot,
    );
    print({
      outcome: "set",
      source: "macos_picker",
      registryPath,
      workspaceId,
      workspaceRoot: workspaces[workspaceId],
    });
  }
} else if (command === "set") {
  if (!workspaceId || !workspaceRoot) usage();
  const canonicalRoot = canonicalWorkspaceRoot(workspaceRoot);
  const workspaces = setNativeLiveMacWorkspaceRegistryEntry(
    registryPath,
    workspaceId,
    canonicalRoot,
  );
  print({
    outcome: "set",
    registryPath,
    workspaceId,
    workspaceRoot: workspaces[workspaceId],
  });
} else if (command === "remove") {
  if (!workspaceId || workspaceRoot !== undefined) usage();
  const result = removeNativeLiveMacWorkspaceRegistryEntry(
    registryPath,
    workspaceId,
  );
  print({
    outcome: result.removed ? "removed" : "not_found",
    registryPath,
    workspaceId,
  });
} else {
  usage();
}

function canonicalWorkspaceRoot(value: string): string {
  const candidate = value.trim();
  if (!candidate || !isAbsolute(candidate)) {
    throw new Error(
      "Workspace root must be a nonblank absolute path.",
    );
  }
  let canonical: string;
  try {
    canonical = realpathSync(candidate);
  } catch {
    throw new Error(
      "Workspace root must resolve to an existing directory.",
    );
  }
  if (!statSync(canonical).isDirectory()) {
    throw new Error(
      "Workspace root must resolve to an existing directory.",
    );
  }
  return canonical;
}

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  pnpm runtime:native-live-workspace list",
      "  pnpm runtime:native-live-workspace pick <workspace-uuid>",
      "  pnpm runtime:native-live-workspace set <workspace-uuid> <absolute-directory>",
      "  pnpm runtime:native-live-workspace remove <workspace-uuid>",
    ].join("\n"),
  );
}
