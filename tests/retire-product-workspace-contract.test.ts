import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import express from "express";
import { createWebApiRouter } from "../src/web-api/router.js";
import { createNativeLiveProviderSessionStoreInternalRouter } from "../src/web-api/native-live-provider-session-store-internal-router.js";

async function withServer(app: express.Express, run: (url: string) => Promise<void>) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("retired product routes stay unavailable even if legacy composition supplies a Workspace service", async () => {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.webUserId = "11111111-1111-4111-8111-111111111111"; next(); });
  app.use("/api/v1", createWebApiRouter({ diary: {}, toy: {}, system: {}, projects: { projectWorkspaceService: { async listProductWorkspaces() { return []; } } } } as never));
  await withServer(app, async url => {
    for (const route of ["/workspaces", "/workspaces/11111111-1111-4111-8111-111111111111", "/workspaces/11111111-1111-4111-8111-111111111111/resources", "/workspaces/11111111-1111-4111-8111-111111111111/conversations"]) {
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) assert.equal((await fetch(url + "/api/v1" + route, { method })).status, 404);
    }
  });
});

test("SessionStore rejects retired namespace rather than silently collapsing an old client's key", async () => {
  let loads = 0;
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.mcpUserId = "tenant-a"; next(); });
  app.use(createNativeLiveProviderSessionStoreInternalRouter({ providerSessionStoreService: { async load() { loads++; return [{ type: "user" }]; } } } as never));
  await withServer(app, async url => {
    const post = (body: unknown) => fetch(url + "/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ key: { session_id: "sdk-session", workspace_id: "11111111-1111-4111-8111-111111111111" } })).status, 400);
    assert.equal(loads, 0);
    assert.equal((await post({ key: { session_id: "sdk-session" } })).status, 200);
    assert.equal(loads, 1);
  });
});

test("iOS has no Product Workspace authority and retains Context, Usage and Fork Session", () => {
  const root = "ios/LeileiOS/LeileiOS/";
  for (const file of ["Navigation/AppPage.swift", "Navigation/SidebarView.swift", "Navigation/PageContainer.swift", "Chat/ChatView.swift", "Chat/ChatView+MessageMutation.swift", "App/AppModel.swift", "App/NativeLiveTurnController.swift", "Infrastructure/API/NativeLive/NativeLiveAPI.swift"]) {
    assert.doesNotMatch(readFileSync(root + file, "utf8"), /\.workspaces|selectedWorkspaceID|activeNativeLiveWorkspace|workspaceID|workspace_id|shouldBindWorkspace/);
  }
  assert.equal(existsSync(root + "Infrastructure/API/Workspace"), false);
  const page = readFileSync(root + "Navigation/PageContainer.swift", "utf8");
  for (const label of ["Context", "Claude Usage", "Fork Session"]) assert.ok(page.includes(`"${label}"`));
  assert.match(readFileSync(root + "Pages/ContextOverviewSheet.swift", "utf8"), /struct ContextOverviewSheet/);
});
