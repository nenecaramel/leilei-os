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
  backupCalls = 0;

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
  async updateNode(_userId: string, node: UniverseSnapshot["nodes"][number], _reason: string, expectedVersion: number): Promise<UniverseReadResult> {
    this.updateNodeCalls += 1;
    this.lastUpdatedNode = node;
    this.lastExpectedVersion = expectedVersion;
    if (expectedVersion !== this.version) throw new UniverseServiceError("VERSION_CONFLICT");
    this.snapshot = { ...this.snapshot!, nodes: this.snapshot!.nodes.map((item) => item.id === node.id ? node : item) };
    this.version += 1;
    return { snapshot: this.snapshot, version: this.version };
  }
  async deleteNode(): Promise<UniverseReadResult> { throw new Error("not used"); }
  async createRelation(): Promise<UniverseReadResult> { throw new Error("not used"); }
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
