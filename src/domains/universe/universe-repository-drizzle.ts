import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  universeBackups,
  universeGalaxies,
  universeMeta,
  universeNodes,
  universeRelations,
  universeRevisions,
  users,
} from "../../database/schema.js";
import { requireActiveUserInTransaction } from "../require-active-user-transaction.js";
import {
  lockAndReadMcpIdempotency,
  recordMcpIdempotency,
} from "../mcp-write/mcp-write-idempotency.js";
import { UniverseServiceError } from "./universe-service.js";
import type {
  UniverseBackup,
  UniverseGalaxy,
  UniverseMeta as CanonicalMeta,
  UniverseNode,
  UniverseRelation,
  UniverseRevision,
  UniverseSnapshot,
} from "./universe-types.js";
import { validateUniverseBackup, validateUniverseSnapshot } from "./universe-validation.js";
import type {
  UniverseMcpCreateResult,
  UniverseReadResult,
  UniverseRepository,
} from "./universe-repository.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;
type Executor = Database | Transaction;

export class DrizzleUniverseRepository implements UniverseRepository {
  constructor(private readonly db: Executor) {}

  async findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async loadUniverse(userId: string): Promise<UniverseReadResult | null> {
    return readUniverse(this.db, userId);
  }

  async saveUniverse(userId: string, snapshot: UniverseSnapshot, expectedVersion: number): Promise<UniverseReadResult> {
    return this.inTransaction(userId, async (repository) => {
      const meta = await repository.lockMeta(userId);
      if (meta && expectedVersion === 0) throw new UniverseServiceError("VERSION_CONFLICT");
      const currentVersion = meta?.version ?? 0;
      if (currentVersion !== expectedVersion) throw new UniverseServiceError("VERSION_CONFLICT");
      if (!meta) {
        try {
          await repository.db.insert(universeMeta).values({
            userId,
            name: snapshot.meta.name,
            schemaVersion: 2,
            createdAt: new Date(snapshot.meta.createdAt),
            updatedAt: new Date(snapshot.meta.updatedAt),
            version: 1,
          });
        } catch (error) {
          if (hasCode(error, "23505")) throw new UniverseServiceError("VERSION_CONFLICT");
          throw error;
        }
      } else {
        await repository.replaceCanonical(userId, snapshot);
        await repository.db.update(universeMeta).set({
          name: snapshot.meta.name,
          schemaVersion: 2,
          createdAt: new Date(snapshot.meta.createdAt),
          updatedAt: new Date(snapshot.meta.updatedAt),
          version: expectedVersion + 1,
        }).where(eq(universeMeta.userId, userId));
      }
      if (!meta) await repository.insertCanonical(userId, snapshot);
      const result = await repository.loadUniverse(userId);
      if (!result) throw new UniverseServiceError("UNIVERSE_FAILED");
      return result;
    });
  }

  async createNode(userId: string, node: UniverseNode, expectedVersion: number): Promise<UniverseReadResult> {
    return this.inTransaction(userId, async (repository) => {
      await repository.assertVersion(userId, expectedVersion);
      await repository.assertGalaxyReferences(userId, node.galaxies);
      try {
        await repository.db.insert(universeNodes).values(toNodeInsert(userId, node));
      } catch (error) {
        if (hasCode(error, "23505")) throw new UniverseServiceError("NODE_CONFLICT");
        throw error;
      }
      await repository.bumpVersion(userId, expectedVersion, node.updatedAt);
      return repository.requireUniverse(userId);
    });
  }

  async createNodeIdempotently(
    userId: string,
    node: UniverseNode,
    expectedVersion: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<UniverseMcpCreateResult<UniverseNode>> {
    return this.db.transaction(async (tx) => {
      const transaction = tx as Transaction;
      const existingLedger = await lockAndReadMcpIdempotency(transaction, {
        userId,
        toolName: "create_universe_node",
        idempotencyKey,
      });
      await requireActiveUserInTransaction(transaction, userId);
      if (existingLedger) {
        if (existingLedger.requestHash !== requestHash || existingLedger.resourceType !== "universe_node") {
          throw new UniverseServiceError("IDEMPOTENCY_CONFLICT");
        }
        const existing = await new DrizzleUniverseRepository(transaction).findNode(userId, existingLedger.resourceId);
        if (!existing) throw new UniverseServiceError("NODE_NOT_FOUND");
        const current = await new DrizzleUniverseRepository(transaction).requireUniverse(userId);
        return { outcome: "replayed", value: existing, version: current.version };
      }

      const repository = new DrizzleUniverseRepository(transaction);
      await repository.assertVersion(userId, expectedVersion);
      await repository.assertGalaxyReferences(userId, node.galaxies);
      try {
        await transaction.insert(universeNodes).values(toNodeInsert(userId, node));
      } catch (error) {
        if (hasCode(error, "23505")) throw new UniverseServiceError("NODE_CONFLICT");
        throw error;
      }
      await repository.bumpVersion(userId, expectedVersion, node.updatedAt);
      await recordMcpIdempotency(transaction, {
        userId,
        toolName: "create_universe_node",
        idempotencyKey,
        requestHash,
        resourceType: "universe_node",
        resourceId: node.id,
      });
      return { outcome: "created", value: node, version: expectedVersion + 1 };
    });
  }

  async updateNode(userId: string, node: UniverseNode, reason: string, expectedVersion: number): Promise<UniverseReadResult> {
    return this.inTransaction(userId, async (repository) => {
      await repository.assertVersion(userId, expectedVersion);
      const existing = await repository.findNode(userId, node.id);
      if (!existing) throw new UniverseServiceError("NODE_NOT_FOUND");
      await repository.assertGalaxyReferences(userId, node.galaxies);
      await repository.db.insert(universeRevisions).values({
        userId,
        id: `revision-${randomUUID()}`,
        nodeId: node.id,
        createdAt: new Date(node.updatedAt),
        reason,
        snapshot: toRevisionSnapshot(existing),
      });
      await repository.db.update(universeNodes).set(toNodeInsert(userId, node)).where(
        and(eq(universeNodes.userId, userId), eq(universeNodes.id, node.id)),
      );
      await repository.bumpVersion(userId, expectedVersion, node.updatedAt);
      return repository.requireUniverse(userId);
    });
  }

  async deleteNode(userId: string, nodeId: string, expectedVersion: number): Promise<UniverseReadResult> {
    return this.inTransaction(userId, async (repository) => {
      await repository.assertVersion(userId, expectedVersion);
      const existing = await repository.findNode(userId, nodeId);
      if (!existing) throw new UniverseServiceError("NODE_NOT_FOUND");
      await repository.db.delete(universeRelations).where(
        and(eq(universeRelations.userId, userId), or(eq(universeRelations.source, nodeId), eq(universeRelations.target, nodeId))),
      );
      await repository.db.delete(universeNodes).where(
        and(eq(universeNodes.userId, userId), eq(universeNodes.id, nodeId)),
      );
      await repository.bumpVersion(userId, expectedVersion, new Date().toISOString());
      return repository.requireUniverse(userId);
    });
  }

  async createRelation(userId: string, relation: UniverseRelation, expectedVersion: number): Promise<UniverseReadResult> {
    return this.inTransaction(userId, async (repository) => {
      await repository.assertVersion(userId, expectedVersion);
      const nodes = await repository.db.select({ id: universeNodes.id }).from(universeNodes).where(
        and(eq(universeNodes.userId, userId), inArray(universeNodes.id, [relation.source, relation.target])),
      );
      if (nodes.length !== 2 && relation.source !== relation.target) {
        throw new UniverseServiceError("RELATION_INVALID");
      }
      if (nodes.length !== 1 && relation.source === relation.target) {
        throw new UniverseServiceError("RELATION_INVALID");
      }
      try {
        await repository.db.insert(universeRelations).values(toRelationInsert(userId, relation));
      } catch (error) {
        if (hasCode(error, "23505")) throw new UniverseServiceError("RELATION_CONFLICT");
        throw error;
      }
      await repository.bumpVersion(userId, expectedVersion, relation.createdAt);
      return repository.requireUniverse(userId);
    });
  }

  async createRelationIdempotently(
    userId: string,
    relation: UniverseRelation,
    expectedVersion: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<UniverseMcpCreateResult<UniverseRelation>> {
    return this.db.transaction(async (tx) => {
      const transaction = tx as Transaction;
      const existingLedger = await lockAndReadMcpIdempotency(transaction, {
        userId,
        toolName: "create_universe_relation",
        idempotencyKey,
      });
      await requireActiveUserInTransaction(transaction, userId);
      if (existingLedger) {
        if (existingLedger.requestHash !== requestHash || existingLedger.resourceType !== "universe_relation") {
          throw new UniverseServiceError("IDEMPOTENCY_CONFLICT");
        }
        const existing = await transaction.select().from(universeRelations).where(
          and(eq(universeRelations.userId, userId), eq(universeRelations.id, existingLedger.resourceId)),
        ).limit(1);
        if (existing.length === 0) throw new UniverseServiceError("RELATION_NOT_FOUND");
        const current = await new DrizzleUniverseRepository(transaction).requireUniverse(userId);
        return { outcome: "replayed", value: fromRelationRow(existing[0]!), version: current.version };
      }

      const repository = new DrizzleUniverseRepository(transaction);
      await repository.assertVersion(userId, expectedVersion);
      const nodes = await transaction.select({ id: universeNodes.id }).from(universeNodes).where(
        and(eq(universeNodes.userId, userId), inArray(universeNodes.id, [relation.source, relation.target])),
      );
      if (nodes.length !== 2 && relation.source !== relation.target) throw new UniverseServiceError("RELATION_INVALID");
      if (nodes.length !== 1 && relation.source === relation.target) throw new UniverseServiceError("RELATION_INVALID");
      try {
        await transaction.insert(universeRelations).values(toRelationInsert(userId, relation));
      } catch (error) {
        if (hasCode(error, "23505")) throw new UniverseServiceError("RELATION_CONFLICT");
        throw error;
      }
      await repository.bumpVersion(userId, expectedVersion, relation.createdAt);
      await recordMcpIdempotency(transaction, {
        userId,
        toolName: "create_universe_relation",
        idempotencyKey,
        requestHash,
        resourceType: "universe_relation",
        resourceId: relation.id,
      });
      return { outcome: "created", value: relation, version: expectedVersion + 1 };
    });
  }

  async deleteRelation(userId: string, relationId: string, expectedVersion: number): Promise<UniverseReadResult> {
    return this.inTransaction(userId, async (repository) => {
      await repository.assertVersion(userId, expectedVersion);
      const deleted = await repository.db.delete(universeRelations).where(
        and(eq(universeRelations.userId, userId), eq(universeRelations.id, relationId)),
      ).returning({ id: universeRelations.id });
      if (deleted.length === 0) throw new UniverseServiceError("RELATION_NOT_FOUND");
      await repository.bumpVersion(userId, expectedVersion, new Date().toISOString());
      return repository.requireUniverse(userId);
    });
  }

  async latestRevision(userId: string, nodeId: string): Promise<UniverseRevision | null> {
    const [row] = await this.db.select().from(universeRevisions).where(
      and(eq(universeRevisions.userId, userId), eq(universeRevisions.nodeId, nodeId)),
    ).orderBy(desc(universeRevisions.createdAt), desc(universeRevisions.id)).limit(1);
    return row ? fromRevisionRow(row) : null;
  }

  async restoreLatestRevision(userId: string, nodeId: string, expectedVersion: number): Promise<UniverseReadResult> {
    return this.inTransaction(userId, async (repository) => {
      await repository.assertVersion(userId, expectedVersion);
      const node = await repository.findNode(userId, nodeId);
      if (!node) throw new UniverseServiceError("NODE_NOT_FOUND");
      const revision = await repository.latestRevision(userId, nodeId);
      if (!revision) throw new UniverseServiceError("REVISION_NOT_FOUND");
      await repository.db.insert(universeRevisions).values({
        userId,
        id: `revision-${randomUUID()}`,
        nodeId,
        createdAt: new Date(),
        reason: "restore_latest_revision",
        snapshot: toRevisionSnapshot(node),
      });
      const restored: UniverseNode = {
        ...node,
        ...revision.snapshot,
        createdAt: node.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await repository.assertGalaxyReferences(userId, restored.galaxies);
      await repository.db.update(universeNodes).set(toNodeInsert(userId, restored)).where(
        and(eq(universeNodes.userId, userId), eq(universeNodes.id, nodeId)),
      );
      await repository.bumpVersion(userId, expectedVersion, restored.updatedAt);
      return repository.requireUniverse(userId);
    });
  }

  async createBackup(userId: string, reason: string): Promise<UniverseBackup> {
    return this.inTransaction(userId, async (repository) => {
      const current = await repository.requireUniverse(userId);
      const createdAt = new Date().toISOString();
      const backup: UniverseBackup = {
        id: `backup-${createdAt}`,
        createdAt,
        reason,
        data: current.snapshot,
      };
      await repository.db.insert(universeBackups).values({
        userId,
        id: backup.id,
        createdAt: new Date(createdAt),
        reason,
        data: backup.data,
      });
      const rows = await repository.db.select({ id: universeBackups.id }).from(universeBackups)
        .where(eq(universeBackups.userId, userId)).orderBy(desc(universeBackups.createdAt), desc(universeBackups.id));
      const stale = rows.slice(8);
      if (stale.length > 0) {
        await repository.db.delete(universeBackups).where(
          and(eq(universeBackups.userId, userId), inArray(universeBackups.id, stale.map((row) => row.id))),
        );
      }
      return backup;
    });
  }

  async latestBackup(userId: string): Promise<UniverseBackup | null> {
    const [row] = await this.db.select().from(universeBackups).where(eq(universeBackups.userId, userId))
      .orderBy(desc(universeBackups.createdAt), desc(universeBackups.id)).limit(1);
    return row ? fromBackupRow(row) : null;
  }

  async restoreBackup(userId: string, backupId: string, expectedVersion: number): Promise<UniverseReadResult> {
    return this.inTransaction(userId, async (repository) => {
      await repository.assertVersion(userId, expectedVersion);
      const [backup] = await repository.db.select().from(universeBackups).where(
        and(eq(universeBackups.userId, userId), eq(universeBackups.id, backupId)),
      ).limit(1);
      if (!backup) throw new UniverseServiceError("BACKUP_NOT_FOUND");
      const snapshot = validateUniverseSnapshot(backup.data);
      await repository.replaceCanonical(userId, snapshot);
      await repository.db.update(universeMeta).set({
        name: snapshot.meta.name,
        schemaVersion: 2,
        createdAt: new Date(snapshot.meta.createdAt),
        updatedAt: new Date(snapshot.meta.updatedAt),
        version: expectedVersion + 1,
      }).where(eq(universeMeta.userId, userId));
      return repository.requireUniverse(userId);
    });
  }

  async ensureDailyBackup(userId: string, reason: string): Promise<UniverseBackup | null> {
    const latest = await this.latestBackup(userId);
    if (latest && Date.now() - Date.parse(latest.createdAt) < 24 * 60 * 60 * 1000) return latest;
    return this.createBackup(userId, reason);
  }

  private async inTransaction<T>(
    userId: string,
    work: (repository: DrizzleUniverseRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await requireActiveUserInTransaction(tx as Transaction, userId);
      return work(new DrizzleUniverseRepository(tx as Transaction));
    });
  }

  private async lockMeta(userId: string) {
    const [meta] = await this.db.select().from(universeMeta)
      .where(eq(universeMeta.userId, userId))
      .for("update")
      .limit(1);
    return meta;
  }

  private async assertVersion(userId: string, expectedVersion: number): Promise<void> {
    const meta = await this.lockMeta(userId);
    if (!meta) throw new UniverseServiceError("UNIVERSE_NOT_INITIALIZED");
    if (meta.version !== expectedVersion) throw new UniverseServiceError("VERSION_CONFLICT");
  }

  private async bumpVersion(userId: string, expectedVersion: number, updatedAt: string): Promise<void> {
    const updated = await this.db.update(universeMeta).set({
      version: expectedVersion + 1,
      updatedAt: new Date(updatedAt),
    }).where(and(eq(universeMeta.userId, userId), eq(universeMeta.version, expectedVersion))).returning({ userId: universeMeta.userId });
    if (updated.length !== 1) throw new UniverseServiceError("VERSION_CONFLICT");
  }

  private async findNode(userId: string, nodeId: string): Promise<UniverseNode | null> {
    const [row] = await this.db.select().from(universeNodes).where(
      and(eq(universeNodes.userId, userId), eq(universeNodes.id, nodeId)),
    ).limit(1);
    return row ? fromNodeRow(row) : null;
  }

  private async assertGalaxyReferences(userId: string, memberships: UniverseNode["galaxies"]): Promise<void> {
    const galaxyIds = memberships.map((membership) => membership.id);
    if (galaxyIds.length === 0) return;
    const rows = await this.db.select({ id: universeGalaxies.id }).from(universeGalaxies).where(
      and(eq(universeGalaxies.userId, userId), inArray(universeGalaxies.id, galaxyIds)),
    );
    if (rows.length !== new Set(galaxyIds).size) throw new UniverseServiceError("INVALID_UNIVERSE");
  }

  private async replaceCanonical(userId: string, snapshot: UniverseSnapshot): Promise<void> {
    await this.db.delete(universeRelations).where(eq(universeRelations.userId, userId));
    await this.db.delete(universeNodes).where(eq(universeNodes.userId, userId));
    await this.db.delete(universeRevisions).where(eq(universeRevisions.userId, userId));
    await this.db.delete(universeGalaxies).where(eq(universeGalaxies.userId, userId));
    await this.insertCanonical(userId, snapshot);
  }

  private async insertCanonical(userId: string, snapshot: UniverseSnapshot): Promise<void> {
    if (snapshot.galaxies.length > 0) {
      await this.db.insert(universeGalaxies).values(snapshot.galaxies.map((galaxy) => ({ userId, ...galaxy })));
    }
    if (snapshot.nodes.length > 0) {
      await this.db.insert(universeNodes).values(snapshot.nodes.map((node) => toNodeInsert(userId, node)));
    }
    if (snapshot.relations.length > 0) {
      await this.db.insert(universeRelations).values(snapshot.relations.map((relation) => toRelationInsert(userId, relation)));
    }
    if (snapshot.revisions.length > 0) {
      await this.db.insert(universeRevisions).values(snapshot.revisions.map((revision) => ({ userId, ...toRevisionInsert(revision) })));
    }
  }

  private async requireUniverse(userId: string): Promise<UniverseReadResult> {
    const result = await readUniverse(this.db, userId);
    if (!result) throw new UniverseServiceError("UNIVERSE_NOT_INITIALIZED");
    return result;
  }
}

async function readUniverse(db: Executor, userId: string): Promise<UniverseReadResult | null> {
  const [meta] = await db.select().from(universeMeta).where(eq(universeMeta.userId, userId)).limit(1);
  if (!meta) return null;
  const [galaxies, nodes, relations, revisions] = await Promise.all([
    db.select().from(universeGalaxies).where(eq(universeGalaxies.userId, userId)).orderBy(asc(universeGalaxies.order), asc(universeGalaxies.id)),
    db.select().from(universeNodes).where(eq(universeNodes.userId, userId)).orderBy(asc(universeNodes.id)),
    db.select().from(universeRelations).where(eq(universeRelations.userId, userId)).orderBy(asc(universeRelations.id)),
    db.select().from(universeRevisions).where(eq(universeRevisions.userId, userId)).orderBy(asc(universeRevisions.createdAt), asc(universeRevisions.id)),
  ]);
  const snapshot = validateUniverseSnapshot({
    schemaVersion: meta.schemaVersion,
    meta: { name: meta.name, createdAt: meta.createdAt.toISOString(), updatedAt: meta.updatedAt.toISOString() },
    galaxies: galaxies.map(fromGalaxyRow),
    nodes: nodes.map(fromNodeRow),
    relations: relations.map(fromRelationRow),
    revisions: revisions.map(fromRevisionRow),
  });
  return { snapshot, version: meta.version };
}

function toNodeInsert(userId: string, node: UniverseNode) {
  return {
    userId,
    id: node.id,
    title: node.title,
    summary: node.summary,
    content: node.content,
    type: node.type,
    tags: node.tags,
    galaxies: [],
    galaxyMemberships: node.galaxies,
    position: node.position,
    createdAt: new Date(node.createdAt),
    updatedAt: new Date(node.updatedAt),
    importance: node.importance ?? null,
    migration: node.migration ?? null,
  };
}

function toRelationInsert(userId: string, relation: UniverseRelation) {
  return {
    userId,
    id: relation.id,
    source: relation.source,
    target: relation.target,
    relationType: relation.relationType,
    strength: relation.strength,
    createdAt: new Date(relation.createdAt),
  };
}

function toRevisionSnapshot(node: UniverseNode) {
  return {
    title: node.title,
    summary: node.summary,
    content: node.content,
    type: node.type,
    tags: node.tags,
    galaxies: node.galaxies,
    ...(node.importance === undefined ? {} : { importance: node.importance }),
    ...(node.migration === undefined ? {} : { migration: node.migration }),
  };
}

function toRevisionInsert(revision: UniverseRevision) {
  return {
    id: revision.id,
    nodeId: revision.nodeId,
    createdAt: new Date(revision.createdAt),
    reason: revision.reason,
    snapshot: revision.snapshot,
  };
}

function fromGalaxyRow(row: typeof universeGalaxies.$inferSelect): UniverseGalaxy {
  return { id: row.id, title: row.title, description: row.description, color: row.color, order: row.order };
}

function fromNodeRow(row: typeof universeNodes.$inferSelect): UniverseNode {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    content: row.content,
    type: row.type,
    tags: row.tags,
    galaxies: row.galaxyMemberships,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.importance === null ? {} : { importance: row.importance }),
    ...(row.migration === null ? {} : { migration: row.migration as UniverseNode["migration"] }),
  };
}

function fromRelationRow(row: typeof universeRelations.$inferSelect): UniverseRelation {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    relationType: row.relationType as UniverseRelation["relationType"],
    strength: row.strength,
    createdAt: row.createdAt.toISOString(),
  };
}

function fromRevisionRow(row: typeof universeRevisions.$inferSelect): UniverseRevision {
  return {
    id: row.id,
    nodeId: row.nodeId,
    createdAt: row.createdAt.toISOString(),
    reason: row.reason,
    snapshot: row.snapshot as UniverseRevision["snapshot"],
  };
}

function fromBackupRow(row: typeof universeBackups.$inferSelect): UniverseBackup {
  return validateUniverseBackup({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    reason: row.reason,
    data: row.data,
  });
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
