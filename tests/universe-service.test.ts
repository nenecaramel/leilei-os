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
    this.lastExpectedVersion = expectedVersion;
    if (expectedVersion !== this.version) throw new UniverseServiceError("VERSION_CONFLICT");
    this.snapshot = { ...this.snapshot!, nodes: [...this.snapshot!.nodes, node] };
    this.version += 1;
    return { snapshot: this.snapshot, version: this.version };
  }
  async updateNode(): Promise<UniverseReadResult> { throw new Error("not used"); }
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
