import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";
import type {
  UniverseGalaxyMembership,
  UniverseBackup,
  UniverseNode,
  UniverseRelation,
  UniverseSnapshot,
} from "./universe-types.js";
import {
  normalizeNodeCreate,
  normalizeRelationCreate,
  validateUniverseNode,
  validateUniverseRelation,
  validateUniverseSnapshot,
} from "./universe-validation.js";
import { UniverseValidationError } from "./universe-validation.js";
import type {
  UniverseReadResult,
  UniverseRepository,
  UniverseWebReadResult,
} from "./universe-repository.js";
import {
  hashMcpWriteRequest,
  normalizeMcpIdempotencyKey,
} from "../mcp-write/mcp-write-idempotency.js";

export type UniverseServiceErrorCode =
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "INVALID_UNIVERSE"
  | "UNIVERSE_NOT_INITIALIZED"
  | "NODE_NOT_FOUND"
  | "NODE_CONFLICT"
  | "RELATION_NOT_FOUND"
  | "RELATION_INVALID"
  | "RELATION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "REVISION_NOT_FOUND"
  | "BACKUP_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "UNIVERSE_FAILED";

export class UniverseServiceError extends Error {
  constructor(public readonly code: UniverseServiceErrorCode, message: string = code) {
    super(message);
    this.name = "UniverseServiceError";
  }
}

export type UniverseNodeUpdate = Partial<Omit<UniverseNode, "id" | "createdAt" | "updatedAt">> & {
  title?: string;
  summary?: string;
  content?: string;
  type?: string;
  tags?: string[];
  galaxies?: UniverseGalaxyMembership[];
  position?: { x: number; y: number };
  importance?: string;
  migration?: UniverseNode["migration"];
};

export type UniverseMcpNodeCreateResult = {
  node: UniverseNode;
  universe_version: number;
  metadata: { created: boolean; idempotent_replay: boolean };
};

export type UniverseMcpRelationCreateResult = {
  relation: UniverseRelation;
  universe_version: number;
  metadata: { created: boolean; idempotent_replay: boolean };
};

export class UniverseService {
  constructor(private readonly repository: UniverseRepository) {}

  async loadUniverse(userId: string): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    const result = await this.repository.loadUniverse(userId);
    if (!result) throw new UniverseServiceError("UNIVERSE_NOT_INITIALIZED");
    return result;
  }

  async loadUniverseWeb(userId: string): Promise<UniverseWebReadResult> {
    await this.requireActiveUser(userId);
    const result = await this.repository.loadUniverseWeb?.(userId);
    if (!result) throw new UniverseServiceError("UNIVERSE_NOT_INITIALIZED");
    return result;
  }

  async searchDiarySourceOptions(userId: string, query: unknown) {
    await this.requireActiveUser(userId);
    if (typeof query !== "string") throw new UniverseServiceError("INVALID_UNIVERSE");
    const result = await this.repository.searchUniverseDiarySourceOptions?.(userId, query.trim());
    if (!result) throw new UniverseServiceError("UNIVERSE_FAILED");
    return result;
  }

  async saveUniverse(userId: string, value: unknown, expectedVersion: number): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    const snapshot = invalidAsServiceError(() => validateUniverseSnapshot(value));
    validateExpectedVersion(expectedVersion);
    return this.repository.saveUniverse(userId, snapshot, expectedVersion);
  }

  async createNode(userId: string, value: unknown, expectedVersion: number): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    const node = invalidAsServiceError(() => normalizeNodeCreate(value));
    return this.repository.createNode(userId, node, expectedVersion);
  }

  async createNodeWeb(userId: string, value: unknown, sourceDiaryIds: unknown, expectedVersion: number): Promise<UniverseWebReadResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    const node = invalidAsServiceError(() => normalizeNodeCreate(value));
    const sources = normalizeSourceDiaryIds(sourceDiaryIds, false) ?? [];
    const result = await this.repository.createNodeWithSources?.(userId, node, sources, expectedVersion);
    if (!result) throw new UniverseServiceError("UNIVERSE_FAILED");
    return result;
  }

  async createMcpNode(
    userId: string,
    value: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<UniverseMcpNodeCreateResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    const key = normalizeMcpIdempotencyKey(idempotencyKey);
    const input = invalidAsServiceError(() => normalizeMcpNodeCreate(value));
    assertMcpPosition(input.position);
    const requestHash = hashMcpWriteRequest({
      title: input.title,
      summary: input.summary,
      content: input.content,
      type: input.type,
      tags: input.tags,
      galaxies: input.galaxies,
      position: input.position,
      expected_version: expectedVersion,
    });
    const result = await this.repository.createNodeIdempotently?.(
      userId,
      input,
      expectedVersion,
      key,
      requestHash,
    );
    if (!result) throw new UniverseServiceError("UNIVERSE_FAILED");
    return {
      node: result.value,
      universe_version: result.version,
      metadata: { created: result.outcome === "created", idempotent_replay: result.outcome === "replayed" },
    };
  }

  async updateNode(
    userId: string,
    nodeId: string,
    patch: UniverseNodeUpdate,
    reason: string,
    expectedVersion: number,
  ): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    if (!nodeId || typeof nodeId !== "string") throw new UniverseServiceError("NODE_NOT_FOUND");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new UniverseServiceError("INVALID_UNIVERSE");
    }
    const current = await this.repository.loadUniverse(userId);
    if (!current) throw new UniverseServiceError("UNIVERSE_NOT_INITIALIZED");
    const existing = current.snapshot.nodes.find((node) => node.id === nodeId);
    if (!existing) throw new UniverseServiceError("NODE_NOT_FOUND");
    const node = invalidAsServiceError(() => validateUniverseNode({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }));
    return this.repository.updateNode(userId, node, reason, expectedVersion);
  }

  async updateNodeWeb(
    userId: string,
    nodeId: string,
    patch: UniverseNodeUpdate,
    sourceDiaryIds: unknown,
    reason: string,
    expectedVersion: number,
  ): Promise<UniverseWebReadResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    if (!nodeId || typeof nodeId !== "string") throw new UniverseServiceError("NODE_NOT_FOUND");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new UniverseServiceError("INVALID_UNIVERSE");
    const current = await this.repository.loadUniverse(userId);
    if (!current) throw new UniverseServiceError("UNIVERSE_NOT_INITIALIZED");
    const existing = current.snapshot.nodes.find((node) => node.id === nodeId);
    if (!existing) throw new UniverseServiceError("NODE_NOT_FOUND");
    const node = invalidAsServiceError(() => validateUniverseNode({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }));
    const sources = normalizeSourceDiaryIds(sourceDiaryIds, true);
    const result = await this.repository.updateNodeWithSources?.(userId, node, reason, sources, expectedVersion);
    if (!result) throw new UniverseServiceError("UNIVERSE_FAILED");
    return result;
  }

  async updateMcpNode(
    userId: string,
    nodeId: string,
    patch: Pick<UniverseNodeUpdate, "title" | "summary" | "content" | "type" | "tags" | "galaxies" | "position">,
    expectedVersion: number,
  ): Promise<UniverseReadResult> {
    if (!patch || Object.keys(patch).length === 0) {
      throw new UniverseServiceError("INVALID_UNIVERSE");
    }
    const allowed = new Set(["title", "summary", "content", "type", "tags", "galaxies", "position"]);
    if (Object.keys(patch).some((key) => !allowed.has(key))) {
      throw new UniverseServiceError("INVALID_UNIVERSE");
    }
    return this.updateNode(userId, nodeId, patch, "mcp_update", expectedVersion);
  }

  async deleteNode(userId: string, nodeId: string, expectedVersion: number): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    return this.repository.deleteNode(userId, nodeId, expectedVersion);
  }

  async createRelation(userId: string, value: unknown, expectedVersion: number): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    const relation = invalidAsServiceError(() => normalizeRelationCreate(value));
    return this.repository.createRelation(userId, relation, expectedVersion);
  }

  async createMcpRelation(
    userId: string,
    value: unknown,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<UniverseMcpRelationCreateResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    const key = normalizeMcpIdempotencyKey(idempotencyKey);
    const input = invalidAsServiceError(() => normalizeMcpRelationCreate(value));
    assertMcpStrength(input.strength);
    if (input.source === input.target) throw new UniverseServiceError("RELATION_INVALID");
    const requestHash = hashMcpWriteRequest({
      source: input.source,
      target: input.target,
      relation_type: input.relationType,
      strength: input.strength,
      expected_version: expectedVersion,
    });
    const result = await this.repository.createRelationIdempotently?.(
      userId,
      input,
      expectedVersion,
      key,
      requestHash,
    );
    if (!result) throw new UniverseServiceError("UNIVERSE_FAILED");
    return {
      relation: result.value,
      universe_version: result.version,
      metadata: { created: result.outcome === "created", idempotent_replay: result.outcome === "replayed" },
    };
  }

  async deleteRelation(userId: string, relationId: string, expectedVersion: number): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    return this.repository.deleteRelation(userId, relationId, expectedVersion);
  }

  async latestRevision(userId: string, nodeId: string) {
    await this.requireActiveUser(userId);
    const revision = await this.repository.latestRevision(userId, nodeId);
    if (!revision) throw new UniverseServiceError("REVISION_NOT_FOUND");
    return revision;
  }

  async restoreLatestRevision(userId: string, nodeId: string, expectedVersion: number): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    return this.repository.restoreLatestRevision(userId, nodeId, expectedVersion);
  }

  async createBackup(userId: string, reason: string): Promise<UniverseBackup> {
    await this.requireActiveUser(userId);
    return this.repository.createBackup(userId, reason);
  }

  async latestBackup(userId: string): Promise<UniverseBackup> {
    await this.requireActiveUser(userId);
    const backup = await this.repository.latestBackup(userId);
    if (!backup) throw new UniverseServiceError("BACKUP_NOT_FOUND");
    return backup;
  }

  async restoreBackup(userId: string, backupId: string, expectedVersion: number): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    validateExpectedVersion(expectedVersion);
    return this.repository.restoreBackup(userId, backupId, expectedVersion);
  }

  async ensureDailyBackup(userId: string): Promise<UniverseBackup | null> {
    await this.requireActiveUser(userId);
    return this.repository.ensureDailyBackup(userId, "daily");
  }

  private async requireActiveUser(userId: string): Promise<void> {
    try {
      await requireActiveUser(this.repository, userId);
    } catch (error) {
      if (error instanceof ActiveUserAuthorizationError) {
        throw new UniverseServiceError(error.code);
      }
      throw error;
    }
  }
}

function validateExpectedVersion(version: number): void {
  if (!Number.isInteger(version) || version < 0) {
    throw new UniverseServiceError("INVALID_UNIVERSE", "expected_version must be a non-negative integer.");
  }
}

function invalidAsServiceError<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof UniverseValidationError) {
      throw new UniverseServiceError("INVALID_UNIVERSE");
    }
    throw error;
  }
}

function normalizeMcpNodeCreate(value: unknown): UniverseNode {
  const record = asRecord(value);
  assertAllowedKeys(record, ["title", "summary", "content", "type", "tags", "galaxies", "position"]);
  return normalizeNodeCreate({
    title: record.title,
    summary: record.summary,
    content: record.content,
    type: record.type,
    tags: record.tags,
    galaxies: record.galaxies,
    position: record.position,
  });
}

function normalizeMcpRelationCreate(value: unknown): UniverseRelation {
  const record = asRecord(value);
  assertAllowedKeys(record, ["source", "target", "relationType", "strength"]);
  return normalizeRelationCreate({
    source: record.source,
    target: record.target,
    relationType: record.relationType,
    strength: record.strength,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UniverseValidationError("MCP Universe input must be an object.");
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) {
    throw new UniverseValidationError("MCP Universe input contains a forbidden field.");
  }
}

function assertMcpPosition(position: { x: number; y: number }): void {
  if (![position.x, position.y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 100)) {
    throw new UniverseServiceError("INVALID_UNIVERSE");
  }
}

function assertMcpStrength(strength: number): void {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new UniverseServiceError("RELATION_INVALID");
  }
}

function normalizeSourceDiaryIds(value: unknown, allowOmitted: boolean): string[] | undefined {
  if (value === undefined && allowOmitted) return undefined;
  if (!Array.isArray(value)) throw new UniverseServiceError("INVALID_UNIVERSE");
  const ids = value.map((id) => typeof id === "string" ? id.trim() : "");
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id))) {
    throw new UniverseServiceError("INVALID_UNIVERSE");
  }
  if (new Set(ids).size !== ids.length) throw new UniverseServiceError("INVALID_UNIVERSE");
  return ids;
}

export type { UniverseBackup, UniverseNode, UniverseRelation, UniverseSnapshot };
