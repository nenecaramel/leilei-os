import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import test from "node:test";
import * as schema from "../src/database/schema.js";
import { DrizzleUniverseRepository } from "../src/domains/universe/universe-repository-drizzle.js";
import { UniverseService, UniverseServiceError } from "../src/domains/universe/universe-service.js";
import { ActiveUserAuthorizationError } from "../src/domains/require-active-user.js";

const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const run = process.env.RUN_UNIVERSE_MCP_WRITE_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsed?.hostname === "localhost" || parsed?.hostname === "127.0.0.1");

function connection() {
  const client = postgres(databaseUrl!, { prepare: false, ssl: false, max: 1 });
  return { client, db: drizzle(client, { schema }) };
}

const now = "2026-08-21T00:00:00.000Z";

test("MCP Universe writes are atomic, idempotent, CAS-safe, and concurrent-safe on disposable PostgreSQL", { skip: !run }, async () => {
  const admin = connection();
  const userId = randomUUID();
  const email = `universe-mcp-${userId}@example.invalid`;
  const nodeKey = "universe-node-integration-0001";
  const relationKey = "universe-relation-integration-0001";
  const nodeInput = { title: "MCP node", summary: "", content: "content", type: "concept", tags: [], galaxies: [], position: { x: 0, y: 100 } };
  try {
    await admin.db.insert(schema.users).values({ id: userId, email, displayName: "Universe MCP", status: "active", createdAt: new Date(now), updatedAt: new Date(now) });
    const service = new UniverseService(new DrizzleUniverseRepository(admin.db as never));
    const empty = { schemaVersion: 2 as const, meta: { name: "MCP Universe", createdAt: now, updatedAt: now }, galaxies: [], nodes: [], relations: [], revisions: [] };
    let version = (await service.saveUniverse(userId, empty, 0)).version;

    const created = await service.createMcpNode(userId, nodeInput, version, nodeKey);
    assert.equal(created.metadata.idempotent_replay, false);
    assert.equal(created.node.id.startsWith("node-"), true);
    version = created.universe_version;
    const updated = await service.updateMcpNode(userId, created.node.id, { summary: "updated", tags: [] }, version);
    assert.equal(updated.version, version + 1);
    assert.equal(updated.snapshot.nodes.find((candidate) => candidate.id === created.node.id)?.content, nodeInput.content);
    const revision = await service.latestRevision(userId, created.node.id);
    assert.equal(revision?.reason, "mcp_update");
    version = updated.version;
    const replay = await service.createMcpNode(userId, nodeInput, 1, nodeKey);
    assert.equal(replay.metadata.idempotent_replay, true);
    assert.equal(replay.node.id, created.node.id);
    assert.equal(replay.universe_version, version);

    await assert.rejects(
      service.createMcpNode(userId, { ...nodeInput, content: "changed" }, 1, nodeKey),
      (error: unknown) => error instanceof UniverseServiceError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      service.createMcpNode(userId, { ...nodeInput, title: "stale" }, version - 1, "universe-node-stale-0001"),
      (error: unknown) => error instanceof UniverseServiceError && error.code === "VERSION_CONFLICT",
    );

    const nodeB = await service.createMcpNode(userId, { ...nodeInput, title: "Node B", position: { x: 50, y: 50 } }, version, "universe-node-integration-0002");
    version = nodeB.universe_version;
    const relation = await service.createMcpRelation(userId, { source: created.node.id, target: nodeB.node.id, relationType: "supports", strength: 1 }, version, relationKey);
    version = relation.universe_version;
    const relationReplay = await service.createMcpRelation(userId, { source: created.node.id, target: nodeB.node.id, relationType: "supports", strength: 1 }, version - 1, relationKey);
    assert.equal(relationReplay.metadata.idempotent_replay, true);
    assert.equal(relationReplay.relation.id, relation.relation.id);
    await assert.rejects(
      service.createMcpRelation(userId, { source: created.node.id, target: nodeB.node.id, relationType: "supports", strength: 0.5 }, version, "universe-relation-integration-0002"),
      (error: unknown) => error instanceof UniverseServiceError && error.code === "RELATION_CONFLICT",
    );
    await assert.rejects(
      service.createMcpRelation(userId, { source: created.node.id, target: created.node.id, relationType: "supports", strength: 0.5 }, version, "universe-relation-integration-0003"),
      (error: unknown) => error instanceof UniverseServiceError && error.code === "RELATION_INVALID",
    );

    const relationBeforeUpdate = relation.relation;
    const strengthUpdate = await service.updateMcpRelation(userId, relationBeforeUpdate.id, { strength: 0.25 }, version);
    assert.equal(strengthUpdate.universe_version, version + 1);
    assert.deepEqual(strengthUpdate.relation, { ...relationBeforeUpdate, strength: 0.25 });
    version = strengthUpdate.universe_version;
    const typeUpdate = await service.updateMcpRelation(userId, relationBeforeUpdate.id, { relationType: "extends" }, version);
    assert.equal(typeUpdate.universe_version, version + 1);
    assert.deepEqual(typeUpdate.relation, { ...relationBeforeUpdate, strength: 0.25, relationType: "extends" });
    version = typeUpdate.universe_version;
    await assert.rejects(
      service.updateMcpRelation(userId, relationBeforeUpdate.id, { strength: 0.5 }, version - 1),
      (error: unknown) => error instanceof UniverseServiceError && error.code === "VERSION_CONFLICT",
    );
    await assert.rejects(
      service.updateMcpRelation(userId, "missing-relation", { strength: 0.5 }, version),
      (error: unknown) => error instanceof UniverseServiceError && error.code === "RELATION_NOT_FOUND",
    );

    const concurrentKey = "universe-node-concurrent-0001";
    const concurrentInput = { ...nodeInput, title: "Concurrent" };
    const [first, second] = await Promise.all([
      (async () => {
        const connectionOne = connection();
        try { return await new UniverseService(new DrizzleUniverseRepository(connectionOne.db as never)).createMcpNode(userId, concurrentInput, version, concurrentKey); }
        finally { await connectionOne.client.end(); }
      })(),
      (async () => {
        const connectionTwo = connection();
        try { return await new UniverseService(new DrizzleUniverseRepository(connectionTwo.db as never)).createMcpNode(userId, concurrentInput, version, concurrentKey); }
        finally { await connectionTwo.client.end(); }
      })(),
    ]);
    assert.equal(new Set([first.node.id, second.node.id]).size, 1);
    assert.equal([first, second].filter((result) => result.metadata.idempotent_replay).length, 1);

    const [ledgerRows] = await admin.db.select({ value: count() }).from(schema.mcpWriteIdempotency).where(and(eq(schema.mcpWriteIdempotency.userId, userId), eq(schema.mcpWriteIdempotency.toolName, "create_universe_node"), eq(schema.mcpWriteIdempotency.idempotencyKey, concurrentKey)));
    assert.equal(ledgerRows?.value, 1);

    await admin.client.unsafe("create or replace function fail_universe_mcp_ledger() returns trigger language plpgsql as $$ begin raise exception 'universe ledger failure'; end $$; create trigger fail_universe_mcp_ledger before insert on mcp_write_idempotency for each row execute function fail_universe_mcp_ledger()");
    await assert.rejects(service.createMcpNode(userId, { ...nodeInput, title: "Rollback" }, first.universe_version, "universe-node-rollback-0001"));
    const rollbackRead = await service.loadUniverse(userId);
    assert.equal(rollbackRead.snapshot.nodes.some((candidate) => candidate.title === "Rollback"), false);
    const rollbackLedger = await admin.db.select({ value: count() }).from(schema.mcpWriteIdempotency).where(and(eq(schema.mcpWriteIdempotency.userId, userId), eq(schema.mcpWriteIdempotency.idempotencyKey, "universe-node-rollback-0001")));
    assert.equal(rollbackLedger[0]?.value, 0);
    await admin.client.unsafe("drop trigger if exists fail_universe_mcp_ledger on mcp_write_idempotency; drop function if exists fail_universe_mcp_ledger()");

    await admin.db.update(schema.users).set({ status: "disabled" }).where(eq(schema.users.id, userId));
    await assert.rejects(service.createMcpNode(userId, { ...nodeInput, title: "Disabled" }, first.universe_version, "universe-node-disabled-0001"), (error: unknown) => error instanceof UniverseServiceError && error.code === "USER_DISABLED");
  } finally {
    await admin.client.unsafe("drop trigger if exists fail_universe_mcp_ledger on mcp_write_idempotency; drop function if exists fail_universe_mcp_ledger()").catch(() => undefined);
    await admin.client.unsafe("delete from users where id = $1::uuid", [userId]).catch(() => undefined);
    await admin.client.end();
  }
});

test("MCP ledger accepts surviving UUID resource ids and prefixed Universe ids after migration", { skip: !run }, async () => {
  const { client, db } = connection();
  const userId = randomUUID();
  try {
    await db.insert(schema.users).values({ id: userId, email: `universe-mcp-ledger-${userId}@example.invalid`, displayName: "Ledger", status: "active" });
    const uuidResource = randomUUID();
    await db.insert(schema.mcpWriteIdempotency).values({ userId, toolName: "write_diary", idempotencyKey: "universe-ledger-uuid-0001", requestHash: "a".repeat(64), resourceType: "diary_entry", resourceId: uuidResource });
    await db.insert(schema.mcpWriteIdempotency).values({ userId, toolName: "create_universe_node", idempotencyKey: "universe-ledger-node-0001", requestHash: "b".repeat(64), resourceType: "universe_node", resourceId: "node-abc" });
    const rows = await db.select({ resourceId: schema.mcpWriteIdempotency.resourceId }).from(schema.mcpWriteIdempotency).where(eq(schema.mcpWriteIdempotency.userId, userId));
    assert.deepEqual(new Set(rows.map((row) => row.resourceId)), new Set([uuidResource, "node-abc"]));
  } finally {
    await client.unsafe("delete from users where id = $1::uuid", [userId]).catch(() => undefined);
    await client.end();
  }
});

test("MCP Universe create transactions reject a concurrent disable before mutation", { skip: !run }, async () => {
  const admin = connection();
  const nodeUserId = randomUUID();
  const relationUserId = randomUUID();
  const now = new Date(nowString());
  const node = (id: string, title: string) => ({
    id,
    title,
    summary: "",
    content: title,
    type: "concept",
    tags: [],
    galaxies: [],
    position: { x: 50, y: 50 },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  const baseSnapshot = (nodes: ReturnType<typeof node>[]) => ({
    schemaVersion: 2 as const,
    meta: { name: "Race", createdAt: now.toISOString(), updatedAt: now.toISOString() },
    galaxies: [],
    nodes,
    relations: [],
    revisions: [],
  });
  const waitForScheduling = () => new Promise((resolve) => setTimeout(resolve, 75));
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };

  async function assertNodeRace(): Promise<void> {
    await admin.db.insert(schema.users).values({
      id: nodeUserId,
      email: `universe-node-race-${nodeUserId}@example.invalid`,
      displayName: "Node race",
      status: "active",
    });
    const service = new UniverseService(new DrizzleUniverseRepository(admin.db as never));
    const initial = await service.saveUniverse(nodeUserId, baseSnapshot([]), 0);
    const disableClient = connection();
    const locked = deferred();
    const release = deferred();
    const disable = disableClient.client.begin(async (transaction) => {
      await transaction`SELECT id FROM users WHERE id = ${nodeUserId}::uuid FOR UPDATE`;
      await transaction`UPDATE users SET status = 'disabled' WHERE id = ${nodeUserId}::uuid`;
      locked.resolve();
      await release.promise;
    });
    try {
      await locked.promise;
      const repository = new DrizzleUniverseRepository(admin.db as never);
      let settled = false;
      const mutation = repository.createNodeIdempotently(
        nodeUserId,
        node("node-race", "blocked node"),
        initial.version,
        "universe-node-race-0001",
        "a".repeat(64),
      ).finally(() => { settled = true; });
      await waitForScheduling();
      assert.equal(settled, false, "the mutation must wait on the disabling user's row lock");
      release.resolve();
      await disable;
      await assert.rejects(
        mutation,
        (error: unknown) => error instanceof ActiveUserAuthorizationError && error.code === "USER_DISABLED",
      );
      const readback = await service.loadUniverse(nodeUserId).catch((error: unknown) => error);
      assert.ok(readback instanceof UniverseServiceError && readback.code === "USER_DISABLED");
      const rows = await admin.db.select({ id: schema.universeNodes.id }).from(schema.universeNodes).where(eq(schema.universeNodes.userId, nodeUserId));
      assert.equal(rows.length, 0);
    } finally {
      release.resolve();
      await disable.catch(() => undefined);
      await disableClient.client.end();
    }
  }

  async function assertRelationRace(): Promise<void> {
    await admin.db.insert(schema.users).values({
      id: relationUserId,
      email: `universe-relation-race-${relationUserId}@example.invalid`,
      displayName: "Relation race",
      status: "active",
    });
    const service = new UniverseService(new DrizzleUniverseRepository(admin.db as never));
    const source = node("node-source", "source");
    const target = node("node-target", "target");
    const initial = await service.saveUniverse(relationUserId, baseSnapshot([source, target]), 0);
    const disableClient = connection();
    const locked = deferred();
    const release = deferred();
    const disable = disableClient.client.begin(async (transaction) => {
      await transaction`SELECT id FROM users WHERE id = ${relationUserId}::uuid FOR UPDATE`;
      await transaction`UPDATE users SET status = 'disabled' WHERE id = ${relationUserId}::uuid`;
      locked.resolve();
      await release.promise;
    });
    try {
      await locked.promise;
      const repository = new DrizzleUniverseRepository(admin.db as never);
      let settled = false;
      const mutation = repository.createRelationIdempotently(
        relationUserId,
        { id: "edge-race", source: source.id, target: target.id, relationType: "supports", strength: 1, createdAt: now.toISOString() },
        initial.version,
        "universe-relation-race-0001",
        "b".repeat(64),
      ).finally(() => { settled = true; });
      await waitForScheduling();
      assert.equal(settled, false, "the relation mutation must wait on the disabling user's row lock");
      release.resolve();
      await disable;
      await assert.rejects(
        mutation,
        (error: unknown) => error instanceof ActiveUserAuthorizationError && error.code === "USER_DISABLED",
      );
      const rows = await admin.db.select({ id: schema.universeRelations.id }).from(schema.universeRelations).where(eq(schema.universeRelations.userId, relationUserId));
      assert.equal(rows.length, 0);
    } finally {
      release.resolve();
      await disable.catch(() => undefined);
      await disableClient.client.end();
    }
  }

  try {
    await assertNodeRace();
    await assertRelationRace();
  } finally {
    await admin.client.unsafe("delete from users where id in ($1::uuid, $2::uuid)", [nodeUserId, relationUserId]).catch(() => undefined);
    await admin.client.end();
  }
});

function nowString(): string {
  return "2026-08-21T00:00:00.000Z";
}
