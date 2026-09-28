import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadNativeLiveMacWorkspaceRegistry,
  nativeLiveMacWorkspaceRegistryPath,
  removeNativeLiveMacWorkspaceRegistryEntry,
  setNativeLiveMacWorkspaceRegistryEntry,
  writeNativeLiveMacWorkspaceRegistry,
} from "../src/domains/bridge/native-live-mac-workspace-registry.js";

const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";

function temporaryHome(): string {
  return mkdtempSync(join(tmpdir(), "leileios-workspaces-"));
}

test("Workspace registry defaults under the local LeileiOS home and missing state is empty", (t) => {
  const home = temporaryHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const registryPath = nativeLiveMacWorkspaceRegistryPath(home);
  assert.equal(
    registryPath,
    join(home, ".leileios", "native-live-workspaces.json"),
  );
  assert.deepEqual(
    loadNativeLiveMacWorkspaceRegistry(registryPath),
    {},
  );
});

test("Workspace registry writes a versioned atomic local mapping with private file permissions", (t) => {
  const home = temporaryHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const registryPath = nativeLiveMacWorkspaceRegistryPath(home);

  const saved = writeNativeLiveMacWorkspaceRegistry(registryPath, {
    [workspaceB]: "/Users/leilei/Projects/b",
    [workspaceA]: "/Users/leilei/Projects/a",
  });

  assert.deepEqual(saved, {
    [workspaceA]: "/Users/leilei/Projects/a",
    [workspaceB]: "/Users/leilei/Projects/b",
  });
  assert.deepEqual(
    JSON.parse(readFileSync(registryPath, "utf8")),
    {
      version: 1,
      workspaces: {
        [workspaceA]: "/Users/leilei/Projects/a",
        [workspaceB]: "/Users/leilei/Projects/b",
      },
    },
  );
  assert.equal(
    statSync(registryPath).mode & 0o077,
    0,
  );
});

test("Workspace registry set/remove mutations preserve unrelated local bindings", (t) => {
  const home = temporaryHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const registryPath = nativeLiveMacWorkspaceRegistryPath(home);

  setNativeLiveMacWorkspaceRegistryEntry(
    registryPath,
    workspaceA,
    "/Users/leilei/Projects/a",
  );
  setNativeLiveMacWorkspaceRegistryEntry(
    registryPath,
    workspaceB,
    "/Users/leilei/Projects/b",
  );
  const removed = removeNativeLiveMacWorkspaceRegistryEntry(
    registryPath,
    workspaceA,
  );
  assert.equal(removed.removed, true);
  assert.deepEqual(removed.workspaces, {
    [workspaceB]: "/Users/leilei/Projects/b",
  });

  const missing = removeNativeLiveMacWorkspaceRegistryEntry(
    registryPath,
    workspaceA,
  );
  assert.equal(missing.removed, false);
  assert.deepEqual(missing.workspaces, {
    [workspaceB]: "/Users/leilei/Projects/b",
  });
});

test("Workspace registry rejects malformed, unsupported, and non-portable documents", (t) => {
  const home = temporaryHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const registryPath = nativeLiveMacWorkspaceRegistryPath(home);
  const directory = join(home, ".leileios");

  writeNativeLiveMacWorkspaceRegistry(registryPath, {});
  writeFileSync(registryPath, "{bad json", "utf8");
  assert.throws(
    () => loadNativeLiveMacWorkspaceRegistry(registryPath),
    /valid JSON/u,
  );

  writeFileSync(
    registryPath,
    JSON.stringify({ version: 2, workspaces: {} }),
    "utf8",
  );
  assert.throws(
    () => loadNativeLiveMacWorkspaceRegistry(registryPath),
    /version is unsupported/u,
  );

  writeFileSync(
    registryPath,
    JSON.stringify({
      version: 1,
      workspaces: {
        [workspaceA]: "./relative",
      },
    }),
    "utf8",
  );
  assert.throws(
    () => loadNativeLiveMacWorkspaceRegistry(registryPath),
    /absolute paths/u,
  );

  assert.ok(directory);
});
