import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { ToyCommandService } from "../src/domains/toy/toy-command-service.js";
import type { ToyCommandRepository } from "../src/domains/toy/toy-command-repository.js";
import { createWebApiRouter } from "../src/web-api/router.js";
import { createToyBridgeRouter } from "../src/web-api/toy-router.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BRIDGE_KEY = "a".repeat(64);

const unreachableRepository: ToyCommandRepository = {
  async findUserById() { return null; },
  async create() { throw new Error("repository must not be called"); },
  async claim() { throw new Error("repository must not be called"); },
  async ack() { throw new Error("repository must not be called"); },
};

test("missing or partial Toy configuration fails closed without affecting existing Web modules", async () => {
  const disabledToy = new ToyCommandService(unreachableRepository, undefined);
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/toy/commands",
    createToyBridgeRouter({ toyService: disabledToy }, undefined),
  );
  app.use((request, _response, next) => {
    request.webUserId = USER_ID;
    next();
  });
  app.use("/api/v1", createWebApiRouter({
    diary: {
      diaryService: {
        async listDiaries() {
          return { diaries: [], metadata: { count: 0 } };
        },
      } as never,
    },
    system: {
      systemService: {
        readConnections() {
          return { web_api: "online", public_mcp: "available", internal_mcp: "not_enabled" };
        },
        async readDataSummary() {
          return {
            memory: { active: 0, archived: 0 },
            diary: { active: 0, archived: 0 },
            task: { active: 0, archived: 0 },
            shared_paper: { active: 0, archived: 0 },
            todo: { active: 0 },
          };
        },
        async readActivity() { return []; },
      },
    },
    toy: { toyService: disabledToy },
  }));

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    for (const path of ["/api/v1/diary"]) {
      assert.equal((await fetch(`${base}${path}`)).status, 200);
    }

    const create = await fetch(`${base}/api/v1/toy/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    assert.equal(create.status, 503);

    const missingKey = await fetch(`${base}/api/v1/toy/commands/claim`, {
      method: "POST",
    });
    assert.equal(missingKey.status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  const partialApp = express();
  partialApp.use(express.json());
  partialApp.use(
    "/api/v1/toy/commands",
    createToyBridgeRouter({ toyService: disabledToy }, BRIDGE_KEY),
  );
  const partialServer = partialApp.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => partialServer.once("listening", resolve));
    const address = partialServer.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/toy/commands/claim`,
      { method: "POST", headers: { "x-leilei-bridge-key": BRIDGE_KEY } },
    );
    assert.equal(response.status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => {
      partialServer.close((error) => error ? reject(error) : resolve());
    });
  }
});
