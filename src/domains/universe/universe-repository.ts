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

export type UniverseNodeDirectoryRecord = {
  id: string;
  title: string;
  type: string;
  tags: string[];
  galaxies: string[];
  importance: string | null;
  updatedAt: Date;
  summaryPreview: string;
};

export type UniverseNodeListResult = {
  nodes: UniverseNodeDirectoryRecord[];
  hasMore: boolean;
  version: number;
};

export type UniverseNodeReadResult = {
  node: UniverseNode;
  version: number;
};

export type UniverseDiarySourceSummary = {
  nodeId: string;
  diaryId: string;
  title: string;
  date: string;
  status: "active" | "archived";
};

export type UniverseDiarySourceOption = {
  id: string;
  title: string;
  date: string;
  status: "active" | "archived";
};

export type UniverseWebReadResult = UniverseReadResult & {
  sources: UniverseDiarySourceSummary[];
};

export type UniverseMcpCreateResult<T> = {
  outcome: "created" | "replayed";
  value: T;
  version: number;
};

export interface UniverseRepository {
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  loadUniverse(userId: string): Promise<UniverseReadResult | null>;
  listUniverseNodes?(userId: string, limit: number, after?: { updatedAt: string; id: string }): Promise<UniverseNodeListResult | null>;
  readUniverseNode?(userId: string, nodeId: string): Promise<{ node: UniverseNode | null; version: number } | null>;
  loadUniverseWeb?(userId: string): Promise<UniverseWebReadResult | null>;
  searchUniverseDiarySourceOptions?(userId: string, query: string): Promise<UniverseDiarySourceOption[]>;
  readUniverseDiarySources?(userId: string, nodeId: string): Promise<UniverseDiarySourceSummary[] | null>;
  saveUniverse(userId: string, snapshot: UniverseSnapshot, expectedVersion: number): Promise<UniverseReadResult>;
  createNode(userId: string, node: UniverseNode, expectedVersion: number): Promise<UniverseReadResult>;
  createNodeWithSources?(
    userId: string,
    node: UniverseNode,
    sourceDiaryIds: string[],
    expectedVersion: number,
  ): Promise<UniverseWebReadResult>;
  createNodeIdempotently?(
    userId: string,
    node: UniverseNode,
    expectedVersion: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<UniverseMcpCreateResult<UniverseNode>>;
  updateNode(userId: string, node: UniverseNode, reason: string, expectedVersion: number): Promise<UniverseReadResult>;
  updateNodeWithSources?(
    userId: string,
    node: UniverseNode,
    reason: string,
    sourceDiaryIds: string[] | undefined,
    expectedVersion: number,
  ): Promise<UniverseWebReadResult>;
  deleteNode(userId: string, nodeId: string, expectedVersion: number): Promise<UniverseReadResult>;
  createRelation(userId: string, relation: UniverseRelation, expectedVersion: number): Promise<UniverseReadResult>;
  createRelationIdempotently?(
    userId: string,
    relation: UniverseRelation,
    expectedVersion: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<UniverseMcpCreateResult<UniverseRelation>>;
  deleteRelation(userId: string, relationId: string, expectedVersion: number): Promise<UniverseReadResult>;
  addUniverseDiarySource(userId: string, nodeId: string, diaryId: string, expectedVersion: number): Promise<UniverseReadResult>;
  deleteUniverseDiarySource(userId: string, nodeId: string, diaryId: string, expectedVersion: number): Promise<UniverseReadResult>;
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
