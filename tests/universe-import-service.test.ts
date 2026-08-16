import assert from "node:assert/strict";
import test from "node:test";
import {
  createLeileiOSUniverseService,
  UniverseInitializationError,
} from "../web/src/pages/universe/universe-service";
import type { UniverseAdapter } from "../web/src/pages/universe/universe-adapter";
import type { UniverseReadResult, UniverseSnapshot } from "../web/src/pages/universe/universe-types";

const snapshot: UniverseSnapshot = {
  schemaVersion: 2,
  meta: { name: "Universe", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" },
  galaxies: [],
  nodes: [],
  relations: [],
  revisions: [],
};
const fresh: UniverseReadResult = { snapshot, version: 1 };

function notInitializedError(): Error & { code: string } {
  return Object.assign(new Error("not initialized"), { code: "UNIVERSE_NOT_INITIALIZED" });
}

function adapterWith(overrides: Partial<UniverseAdapter> = {}): UniverseAdapter {
  return {
    loadUniverse: async () => fresh,
    saveUniverse: async () => fresh,
    createNode: async () => fresh,
    updateNode: async () => fresh,
    deleteNode: async () => fresh,
    createRelation: async () => fresh,
    deleteRelation: async () => fresh,
    latestRevision: async () => ({ id: "r", nodeId: "n", createdAt: "2026-08-01T00:00:00.000Z", reason: "test", snapshot: { title: "", summary: "", content: "", type: "concept", tags: [], galaxies: [] } }),
    restoreLatestRevision: async () => fresh,
    createBackup: async () => ({ id: "b", createdAt: "2026-08-01T00:00:00.000Z", reason: "test", data: snapshot }),
    latestBackup: async () => null,
    ensureDailyBackup: async () => null,
    restoreBackup: async () => fresh,
    ...overrides,
  };
}

test("initializeUniverse writes once at version zero and then reads fresh state", async () => {
  const calls: string[] = [];
  const adapter = adapterWith({
    saveUniverse: async (_value, expectedVersion) => { calls.push(`save:${expectedVersion}`); return fresh; },
    loadUniverse: async () => {
      calls.push("load");
      if (calls.length === 1) throw notInitializedError();
      return fresh;
    },
  });
  const service = createLeileiOSUniverseService({ adapter });
  const result = await service.initializeUniverse(snapshot);
  assert.deepEqual(calls, ["load", "save:0", "load"]);
  assert.deepEqual(result, { state: fresh, writeFailed: false });
});

test("initializeUniverse refuses to write when the preflight GET finds an existing Universe", async () => {
  const calls: string[] = [];
  const adapter = adapterWith({
    loadUniverse: async () => { calls.push("load"); return fresh; },
    saveUniverse: async () => { calls.push("save"); return fresh; },
  });
  const service = createLeileiOSUniverseService({ adapter });
  await assert.rejects(
    service.initializeUniverse(snapshot),
    (error: unknown) => error instanceof UniverseInitializationError && error.code === "UNIVERSE_IMPORT_ALREADY_INITIALIZED",
  );
  assert.deepEqual(calls, ["load"]);
});

test("initializeUniverse stops before PUT when the preflight GET is indeterminate", async () => {
  const calls: string[] = [];
  const adapter = adapterWith({
    loadUniverse: async () => { calls.push("load"); throw new Error("network failed"); },
    saveUniverse: async () => { calls.push("save"); return fresh; },
  });
  const service = createLeileiOSUniverseService({ adapter });
  await assert.rejects(
    service.initializeUniverse(snapshot),
    (error: unknown) => error instanceof UniverseInitializationError && error.code === "UNIVERSE_IMPORT_UNCERTAIN",
  );
  assert.deepEqual(calls, ["load"]);
});

test("initializeUniverse keeps a ready GET result when PUT fails without retrying", async () => {
  const calls: string[] = [];
  const adapter = adapterWith({
    saveUniverse: async () => { calls.push("save"); throw new Error("write failed"); },
    loadUniverse: async () => {
      calls.push("load");
      if (calls.length === 1) throw notInitializedError();
      return fresh;
    },
  });
  const service = createLeileiOSUniverseService({ adapter });
  const result = await service.initializeUniverse(snapshot);
  assert.deepEqual(calls, ["load", "save", "load"]);
  assert.deepEqual(result, { state: fresh, writeFailed: true });
});

test("initializeUniverse reports not written when failed PUT is still uninitialized", async () => {
  const calls: string[] = [];
  const adapter = adapterWith({
    saveUniverse: async () => { calls.push("save"); throw new Error("write failed"); },
    loadUniverse: async () => { calls.push("load"); throw notInitializedError(); },
  });
  const service = createLeileiOSUniverseService({ adapter });
  await assert.rejects(
    service.initializeUniverse(snapshot),
    (error: unknown) => error instanceof UniverseInitializationError && error.code === "UNIVERSE_IMPORT_NOT_WRITTEN",
  );
  assert.deepEqual(calls, ["load", "save", "load"]);
});

test("initializeUniverse does not retry when follow-up GET is indeterminate", async () => {
  const calls: string[] = [];
  const adapter = adapterWith({
    saveUniverse: async () => { calls.push("save"); return fresh; },
    loadUniverse: async () => {
      calls.push("load");
      if (calls.length === 1) throw notInitializedError();
      throw new Error("network failed");
    },
  });
  const service = createLeileiOSUniverseService({ adapter });
  await assert.rejects(
    service.initializeUniverse(snapshot),
    (error: unknown) => error instanceof UniverseInitializationError && error.code === "UNIVERSE_IMPORT_UNCERTAIN",
  );
  assert.deepEqual(calls, ["load", "save", "load"]);
});
