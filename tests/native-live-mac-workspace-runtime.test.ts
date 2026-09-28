import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacWorkspaceRuntimePool,
} from "../src/domains/bridge/native-live-mac-workspace-runtime.js";

const workspaceId = "55555555-5555-4555-8555-555555555555";
const workspaceRoot = "/Users/leilei/Projects/demo";

function fakeRuntime() {
  return {
    abort() {},
    async deleteSession() {},
    async sendNew() {
      return { providerSessionId: "provider-new", normalizedEvents: [] };
    },
    async resume() {
      return { providerSessionId: "provider-resume", normalizedEvents: [] };
    },
    async fork() {
      return { providerSessionId: "provider-fork", normalizedEvents: [] };
    },
  };
}

test("workspace runtime pool resolves mapped Workspace and reuses transport by canonical root", async () => {
  const created: string[] = [];
  const pool = new NativeLiveMacWorkspaceRuntimePool(
    {},
    "/Users/leilei",
    { [workspaceId]: workspaceRoot },
    async (_environment, root) => {
      created.push(root!);
      return { kind: "agent_sdk", runtime: fakeRuntime() };
    },
  );

  const first = await pool.resolveWorkspaceRuntime({
    workspaceId,
    expectedWorkspaceRoot: null,
  });
  const second = await pool.resolveWorkspaceRuntime({
    workspaceId,
    expectedWorkspaceRoot: workspaceRoot,
  });

  assert.equal(first.workspaceRoot, workspaceRoot);
  assert.equal(second.runtime, first.runtime);
  assert.deepEqual(created, [workspaceRoot]);
});

test("workspace runtime pool fails closed for unmapped Workspace and moved session root", async () => {
  const pool = new NativeLiveMacWorkspaceRuntimePool(
    {},
    "/Users/leilei",
    { [workspaceId]: workspaceRoot },
    async () => ({ kind: "agent_sdk", runtime: fakeRuntime() }),
  );

  await assert.rejects(
    () => pool.resolveWorkspaceRuntime({
      workspaceId: "66666666-6666-4666-8666-666666666666",
      expectedWorkspaceRoot: null,
    }),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "runtimeCode" in error
      && (error as { runtimeCode?: unknown }).runtimeCode
        === "WORKSPACE_UNAVAILABLE",
  );

  await assert.rejects(
    () => pool.resolveWorkspaceRuntime({
      workspaceId,
      expectedWorkspaceRoot: "/Users/leilei/Projects/old-demo",
    }),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "runtimeCode" in error
      && (error as { runtimeCode?: unknown }).runtimeCode
        === "WORKSPACE_ROOT_MISMATCH",
  );
});


test("workspace runtime pool isolates SessionStore identity even when roots are equal", async () => {
  const workspaceB = "66666666-6666-4666-8666-666666666666";
  const stores: string[] = [];
  const transports: Array<{ root: string; store: unknown }> = [];
  const pool = new NativeLiveMacWorkspaceRuntimePool(
    {},
    "/Users/leilei",
    {
      [workspaceId]: workspaceRoot,
      [workspaceB]: workspaceRoot,
    },
    async (_environment, root, store) => {
      transports.push({ root: root!, store });
      return { kind: "agent_sdk", runtime: fakeRuntime() };
    },
    (id) => {
      stores.push(id);
      return { workspaceId: id };
    },
  );

  const first = await pool.resolveWorkspaceRuntime({
    workspaceId,
    expectedWorkspaceRoot: null,
  });
  const second = await pool.resolveWorkspaceRuntime({
    workspaceId: workspaceB,
    expectedWorkspaceRoot: null,
  });

  assert.notEqual(first.runtime, second.runtime);
  assert.deepEqual(stores, [workspaceId, workspaceB]);
  assert.deepEqual(transports, [
    {
      root: workspaceRoot,
      store: { workspaceId },
    },
    {
      root: workspaceRoot,
      store: { workspaceId: workspaceB },
    },
  ]);
});
