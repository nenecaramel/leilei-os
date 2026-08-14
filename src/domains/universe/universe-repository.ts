import type {
  UniverseBackup,
  UniverseNode,
  UniverseRelation,
  UniverseRevision,
  UniverseSnapshot,
} from "./universe-types.js";

export type UniverseReadResult = {
  snapshot: UniverseSnapshot;
  version: number;
};

export interface UniverseRepository {
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  loadUniverse(userId: string): Promise<UniverseReadResult | null>;
  saveUniverse(userId: string, snapshot: UniverseSnapshot, expectedVersion: number): Promise<UniverseReadResult>;
  createNode(userId: string, node: UniverseNode, expectedVersion: number): Promise<UniverseReadResult>;
  updateNode(userId: string, node: UniverseNode, reason: string, expectedVersion: number): Promise<UniverseReadResult>;
  deleteNode(userId: string, nodeId: string, expectedVersion: number): Promise<UniverseReadResult>;
  createRelation(userId: string, relation: UniverseRelation, expectedVersion: number): Promise<UniverseReadResult>;
  deleteRelation(userId: string, relationId: string, expectedVersion: number): Promise<UniverseReadResult>;
  latestRevision(userId: string, nodeId: string): Promise<UniverseRevision | null>;
  restoreLatestRevision(userId: string, nodeId: string, expectedVersion: number): Promise<UniverseReadResult>;
  createBackup(userId: string, reason: string): Promise<UniverseBackup>;
  latestBackup(userId: string): Promise<UniverseBackup | null>;
  restoreBackup(userId: string, backupId: string, expectedVersion: number): Promise<UniverseReadResult>;
  ensureDailyBackup(userId: string, reason: string): Promise<UniverseBackup | null>;
}

export type {
  UniverseBackup,
  UniverseNode,
  UniverseRelation,
  UniverseSnapshot,
} from "./universe-types.js";
