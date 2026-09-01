import assert from "node:assert/strict";
import test from "node:test";
import { UniverseService, UniverseServiceError } from "../src/domains/universe/universe-service.js";
import type {
  UniverseBackup,
  UniverseReadResult,
  UniverseRepository,
  UniverseSnapshot,
} from "../src/domains/universe/universe-repository.js";

const timestamp = "2026-08-14T00:00:00.000Z";
const emptySnapshot: UniverseSnapshot = {
  schemaVersion: 2,
  meta: { name: "Universe", createdAt: timestamp, updatedAt: timestamp },
  galaxies: [],
  nodes: [],
  relations: [],
  revisions: [],
};

class FakeRepository implements UniverseRepository {
  userStatus: "active" | "disabled" = "active";
  version = 1;
  snapshot: UniverseSnapshot | null = emptySnapshot;
  lastExpectedVersion: number | undefined;
  createNodeCalls = 0;
  updateNodeCalls = 0;
  lastCreatedNode: UniverseSnapshot["nodes"][number] | undefined;
  lastUpdatedNode: UniverseSnapshot["nodes"][number] | undefined;
  lastUpdateReason: string | undefined;
  backupCalls = 0;
  mcpNodeCalls = 0;
  mcpRelationCalls = 0;
  relationUpdateCalls = 0;
  lastUpdatedRelation: UniverseSnapshot["relations"][number] | undefined;

  async findUserById(): Promise<{ status: "active" | "disabled" } | null> {
    return { status: this.userStatus };
  }
  async loadUniverse(): Promise<UniverseReadResult | null> {
    return this.snapshot ? { snapshot: this.snapshot, version: this.version } : null;
  }
  async saveUniverse(_userId: string, snapshot: UniverseSnapshot, expectedVersion: number): Promise<UniverseReadResult> {
    this.lastExpectedVersion = expectedVersion;
    if (expectedVersion !== this.version) throw new UniverseServiceError("VERSION_CONFLICT");
    this.snapshot = snapshot;
    this.version += 1;
    return { snapshot, version: this.version };
  }
  async createNode(_userId: string, node: UniverseSnapshot["nodes"][number], expectedVersion: number): Promise<UniverseReadResult> {
    this.createNodeCalls += 1;
    this.lastCreatedNode = node;
    this.lastExpectedVersion = expectedVersion;
    if (expectedVersion !== this.version) throw new UniverseServiceError("VERSION_CONFLICT");
    this.snapshot = { ...this.snapshot!, nodes: [...this.snapshot!.nodes, node] };
    this.version += 1;
    return { snapshot: this.snapshot, version: this.version };
  }
  async createNodeIdempotently(_userId: string, node: UniverseSnapshot["nodes"][number], expectedVersion: number): Promise<{ outcome: "created"; value: UniverseSnapshot["nodes"][number]; version: number }> {
    this.mcpNodeCalls += 1;
    this.lastExpectedVersion = expectedVersion;
    return { outcome: "created", value: node, version: expectedVersion + 1 };
  }
  async updateNode(_userId: string, node: UniverseSnapshot["nodes"][number], reason: string, expectedVersion: number): Promise<UniverseReadResult> {
    this.updateNodeCalls += 1;
    this.lastUpdatedNode = node;
    this.lastUpdateReason = reason;
    this.lastExpectedVersion = expectedVersion;
    if (expectedVersion !== this.version) throw new UniverseServiceError("VERSION_CONFLICT");
    this.snapshot = { ...this.snapshot!, nodes: this.snapshot!.nodes.map((item) => item.id === node.id ? node : item) };
    this.version += 1;
    return { snapshot: this.snapshot, version: this.version };
  }
  async deleteNode(): Promise<UniverseReadResult> { throw new Error("not used"); }
  async createRelation(): Promise<UniverseReadResult> { throw new Error("not used"); }
  async createRelationIdempotently(_userId: string, relation: UniverseSnapshot["relations"][number], expectedVersion: number): Promise<{ outcome: "created"; value: UniverseSnapshot["relations"][number]; version: number }> {
    this.mcpRelationCalls += 1;
    this.lastExpectedVersion = expectedVersion;
    return { outcome: "created", value: relation, version: expectedVersion + 1 };
  }
  async updateRelation(_userId: string, relationId: string, patch: { relationType?: UniverseSnapshot["relations"][number]["relationType"]; strength?: number }, expectedVersion: number) {
    this.relationUpdateCalls += 1;
    if (expectedVersion !== this.version) throw new UniverseServiceError("VERSION_CONFLICT");
    const existing = this.snapshot?.relations.find((item) => item.id === relationId);
    if (!existing) throw new UniverseServiceError("RELATION_NOT_FOUND");
    this.lastUpdatedRelation = { ...existing, ...patch };
    this.snapshot = { ...this.snapshot!, relations: this.snapshot!.relations.map((item) => item.id === relationId ? this.lastUpdatedRelation! : item) };
    this.version += 1;
    return { relation: this.lastUpdatedRelation, version: this.version };
  }
  async deleteRelation(): Promise<UniverseReadResult> { throw new Error("not used"); }
  async latestRevision(): Promise<UniverseSnapshot["revisions"][number] | null> { throw new Error("not used"); }
  async restoreLatestRevision(): Promise<UniverseReadResult> { throw new Error("not used"); }
  async createBackup(): Promise<UniverseBackup> { this.backupCalls += 1; throw new Error("not used"); }
  async latestBackup(): Promise<UniverseBackup | null> { throw new Error("not used"); }
  async restoreBackup(): Promise<UniverseReadResult> { throw new Error("not used"); }
  async ensureDailyBackup(): Promise<UniverseBackup | null> { throw new Error("not used"); }
}

test("createNode preserves supplied id/timestamps and increments remote version once", async () => {
  const repository = new FakeRepository();
  const service = new UniverseService(repository);
  const result = await service.createNode("user-1", {
    id: "node-kept",
    title: "Title",
    summary: "Summary",
    content: "Content",
    type: "legacy",
    tags: [],
    galaxies: [],
    position: { x: 0, y: 0 },
    createdAt: timestamp,
  }, 1);
  assert.equal(result.version, 2);
  assert.equal(result.snapshot.nodes[0]?.id, "node-kept");
  assert.equal(result.snapshot.nodes[0]?.createdAt, timestamp);
  assert.equal(repository.createNodeCalls, 1);
});

test("service preserves exact weighted memberships on create and update", async () => {
  const repository = new FakeRepository();
  const service = new UniverseService(repository);
  const memberships = [
    { id: "galaxy-a", weight: 0.123456789 },
    { id: "galaxy-b", weight: 0.876543211 },
  ];
  await service.createNode("user-1", {
    id: "weighted-node",
    title: "Title",
    summary: "Summary",
    content: "Content",
    type: "concept",
    tags: [],
    galaxies: memberships,
    position: { x: 0, y: 0 },
    createdAt: timestamp,
  }, 1);
  assert.deepEqual(repository.lastCreatedNode?.galaxies, memberships);

  await service.updateNode("user-1", "weighted-node", {
    galaxies: [{ id: "galaxy-a", weight: 0.333333333 }, { id: "galaxy-b", weight: 0.666666667 }],
  }, "weight update", 2);
  assert.deepEqual(repository.lastUpdatedNode?.galaxies, [
    { id: "galaxy-a", weight: 0.333333333 },
    { id: "galaxy-b", weight: 0.666666667 },
  ]);
  assert.equal(repository.updateNodeCalls, 1);
});

test("service maps legacy and duplicate memberships to INVALID_UNIVERSE", async () => {
  const service = new UniverseService(new FakeRepository());
  for (const galaxies of [
    ["galaxy-a"],
    [{ id: "galaxy-a", weight: 0.5 }, { id: "galaxy-a", weight: 0.5 }],
  ]) {
    await assert.rejects(
      service.createNode("user-1", {
        title: "Title", summary: "Summary", content: "Content", type: "concept",
        tags: [], galaxies, position: { x: 0, y: 0 },
      }, 1),
      (error: unknown) => error instanceof UniverseServiceError && error.code === "INVALID_UNIVERSE",
    );
  }
});

test("disabled users are rejected before repository mutation", async () => {
  const repository = new FakeRepository();
  repository.userStatus = "disabled";
  const service = new UniverseService(repository);
  await assert.rejects(
    service.createNode("user-1", {
      title: "Title", summary: "Summary", content: "Content", type: "concept",
      tags: [], galaxies: [], position: { x: 0, y: 0 },
    }, 1),
    (error: unknown) => error instanceof UniverseServiceError && error.code === "USER_DISABLED",
  );
  assert.equal(repository.createNodeCalls, 0);
});

test("stale version conflicts without mutating the current snapshot", async () => {
  const repository = new FakeRepository();
  const service = new UniverseService(repository);
  const before = repository.snapshot;
  await assert.rejects(
    service.saveUniverse("user-1", emptySnapshot, 0),
    (error: unknown) => error instanceof UniverseServiceError && error.code === "VERSION_CONFLICT",
  );
  assert.deepEqual(repository.snapshot, before);
});

test("service converts canonical validation failures into the stable domain error", async () => {
  const service = new UniverseService(new FakeRepository());
  await assert.rejects(
    service.createNode("user-1", {
      title: "bad", summary: "bad", content: "bad", type: "future", tags: [], galaxies: [], position: { x: Infinity, y: 0 },
    }, 1),
    (error: unknown) => error instanceof UniverseServiceError && error.code === "INVALID_UNIVERSE",
  );
});

test("Web Universe node writes carry source ids through one CAS-aware repository call", async () => {
  const sourceCalls: Array<string[] | undefined> = [];
  const webResult = { snapshot: emptySnapshot, version: 2, sources: [] };
  const repository = Object.assign(new FakeRepository(), {
    async loadUniverseWeb() { return webResult; },
    async createNodeWithSources(_userId: string, _node: UniverseSnapshot["nodes"][number], sourceIds: string[], _expectedVersion: number) {
      sourceCalls.push(sourceIds);
      return webResult;
    },
    async updateNodeWithSources(_userId: string, _node: UniverseSnapshot["nodes"][number], _reason: string, sourceIds: string[] | undefined, _expectedVersion: number) {
      sourceCalls.push(sourceIds);
      return webResult;
    },
  }) as FakeRepository & UniverseRepository;
  const service = new UniverseService(repository);
  const node = { title: "Title", summary: "", content: "", type: "concept", tags: [], galaxies: [], position: { x: 0, y: 0 } };
  repository.snapshot = { ...emptySnapshot, nodes: [{ id: "node-existing", ...node, createdAt: timestamp, updatedAt: timestamp }] };
  await service.createNodeWeb("user-1", node, ["00000000-0000-1000-8000-000000000001"], 1);
  await service.updateNodeWeb("user-1", "node-existing", { content: "changed" }, undefined, "edit", 1);
  await service.updateNodeWeb("user-1", "node-existing", { content: "changed" }, [], "edit", 1);
  assert.deepEqual(sourceCalls, [["00000000-0000-1000-8000-000000000001"], undefined, []]);
});

test("Web Universe create defaults omitted source ids to an empty set", async () => {
  const sourceCalls: Array<string[] | undefined> = [];
  const webResult = { snapshot: emptySnapshot, version: 2, sources: [] };
  const repository = Object.assign(new FakeRepository(), {
    async createNodeWithSources(_userId: string, _node: UniverseSnapshot["nodes"][number], sourceIds: string[], _expectedVersion: number) {
      sourceCalls.push(sourceIds);
      return webResult;
    },
  }) as FakeRepository & UniverseRepository;
  const service = new UniverseService(repository);
  const node = { title: "Title", summary: "", content: "", type: "concept", tags: [], galaxies: [], position: { x: 0, y: 0 } };
  await service.createNodeWeb("user-1", node, undefined, 1);
  assert.deepEqual(sourceCalls, [[]]);
});

test("Web Universe source ids reject duplicate or malformed values before repository mutation", async () => {
  const repository = Object.assign(new FakeRepository(), {
    async createNodeWithSources() { throw new Error("must not call repository"); },
  }) as FakeRepository & UniverseRepository;
  const service = new UniverseService(repository);
  const node = { title: "Title", summary: "", content: "", type: "concept", tags: [], galaxies: [], position: { x: 0, y: 0 } };
  for (const sourceIds of [["not-a-uuid", "not-a-uuid"], "not-an-array"] as unknown[]) {
    await assert.rejects(
      service.createNodeWeb("user-1", node, sourceIds, 1),
      (error: unknown) => error instanceof UniverseServiceError && error.code === "INVALID_UNIVERSE",
    );
  }
});

test("MCP Universe service creates authoritative node/relation results with durable request boundaries", async () => {
  const repository = new FakeRepository();
  const service = new UniverseService(repository);
  const nodeResult = await service.createMcpNode("user-1", {
    title: "MCP node", summary: "", content: "", type: "concept", tags: [], galaxies: [], position: { x: 0, y: 100 },
  }, 1, "universe-node-create-0001");
  assert.equal(nodeResult.node.id.startsWith("node-"), true);
  assert.equal(nodeResult.universe_version, 2);
  assert.deepEqual(nodeResult.metadata, { created: true, idempotent_replay: false });
  assert.equal(repository.mcpNodeCalls, 1);

  const relationResult = await service.createMcpRelation("user-1", {
    source: "node-a", target: "node-b", relationType: "supports", strength: 0,
  }, 1, "universe-relation-create-0001");
  assert.equal(relationResult.relation.id.startsWith("edge-"), true);
  assert.equal(relationResult.relation.strength, 0);
  assert.equal(repository.mcpRelationCalls, 1);
});

test("MCP Universe service rejects forbidden generated-field input and self relations", async () => {
  const repository = new FakeRepository();
  const service = new UniverseService(repository);
  await assert.rejects(
    service.createMcpNode("user-1", {
      id: "caller-id", title: "Node", summary: "", content: "", type: "concept", tags: [], galaxies: [], position: { x: 1, y: 1 },
    }, 1, "universe-node-create-0002"),
    (error: unknown) => error instanceof UniverseServiceError && error.code === "INVALID_UNIVERSE",
  );
  await assert.rejects(
    service.createMcpRelation("user-1", { source: "node-a", target: "node-a", relationType: "supports", strength: 0.5 }, 1, "universe-relation-create-0002"),
    (error: unknown) => error instanceof UniverseServiceError && error.code === "RELATION_INVALID",
  );
  await assert.rejects(
    service.createMcpNode("user-1", { title: "Node", summary: "", content: "", type: "concept", tags: [], galaxies: [], position: { x: 101, y: 1 } }, 1, "universe-node-create-0003"),
    (error: unknown) => error instanceof UniverseServiceError && error.code === "INVALID_UNIVERSE",
  );
  await assert.rejects(
    service.createMcpRelation("user-1", { source: "node-a", target: "node-b", relationType: "supports", strength: 2 }, 1, "universe-relation-create-0003"),
    (error: unknown) => error instanceof UniverseServiceError && error.code === "RELATION_INVALID",
  );
});

test("MCP Universe update keeps partial patch semantics and fixed revision reason", async () => {
  const repository = new FakeRepository();
  const existing = {
    id: "node-existing", title: "Title", summary: "Summary", content: "Content", type: "concept", tags: ["old"], galaxies: [],
    position: { x: 10, y: 20 }, createdAt: timestamp, updatedAt: timestamp,
  } as const;
  repository.snapshot = { ...emptySnapshot, nodes: [existing] };
  repository.version = 1;
  const service = new UniverseService(repository);
  const result = await service.updateMcpNode("user-1", existing.id, { summary: "", tags: [] }, 1);
  const updated = result.snapshot.nodes[0]!;
  assert.equal(updated.summary, "");
  assert.deepEqual(updated.tags, []);
  assert.equal(updated.content, existing.content);
  assert.deepEqual(updated.position, existing.position);
  assert.equal(repository.lastUpdateReason, "mcp_update");
  await assert.rejects(service.updateMcpNode("user-1", existing.id, {}, 2), (error: unknown) => error instanceof UniverseServiceError && error.code === "INVALID_UNIVERSE");
  await assert.rejects(service.updateMcpNode("user-1", existing.id, { importance: "anchor" } as never, 2), (error: unknown) => error instanceof UniverseServiceError && error.code === "INVALID_UNIVERSE");
});

test("MCP Universe relation update validates patches and preserves immutable fields", async () => {
  const repository = new FakeRepository();
  const existing = { id: "edge-existing", source: "node-a", target: "node-b", relationType: "supports" as const, strength: 0.4, createdAt: timestamp };
  repository.snapshot = { ...emptySnapshot, relations: [existing] };
  repository.version = 7;
  const service = new UniverseService(repository);

  const result = await service.updateMcpRelation("user-1", existing.id, { relationType: "raises", strength: 0.9 }, 7);
  assert.equal(result.universe_version, 8);
  assert.deepEqual(result.relation, { ...existing, relationType: "raises", strength: 0.9 });
  assert.equal(repository.relationUpdateCalls, 1);
  assert.equal(result.relation.id, existing.id);
  assert.equal(result.relation.source, existing.source);
  assert.equal(result.relation.target, existing.target);
  assert.equal(result.relation.createdAt, existing.createdAt);

  for (const [patch, code] of [
    [{}, "INVALID_UNIVERSE"],
    [{ strength: -0.1 }, "RELATION_INVALID"],
    [{ strength: 1.1 }, "RELATION_INVALID"],
    [{ relationType: "not-a-relation" }, "RELATION_INVALID"],
    [{ source: "forbidden" }, "INVALID_UNIVERSE"],
  ] as const) {
    await assert.rejects(
      service.updateMcpRelation("user-1", existing.id, patch, 8),
      (error: unknown) => error instanceof UniverseServiceError && error.code === code,
    );
  }
  assert.equal(repository.relationUpdateCalls, 1);
});
