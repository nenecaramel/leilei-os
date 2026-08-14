import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";
import type {
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
} from "./universe-repository.js";

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
  galaxies?: string[];
  position?: { x: number; y: number };
  importance?: string;
  migration?: UniverseNode["migration"];
};

export class UniverseService {
  constructor(private readonly repository: UniverseRepository) {}

  async loadUniverse(userId: string): Promise<UniverseReadResult> {
    await this.requireActiveUser(userId);
    const result = await this.repository.loadUniverse(userId);
    if (!result) throw new UniverseServiceError("UNIVERSE_NOT_INITIALIZED");
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

export type { UniverseBackup, UniverseNode, UniverseRelation, UniverseSnapshot };
