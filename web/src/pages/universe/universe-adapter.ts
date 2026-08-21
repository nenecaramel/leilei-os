import type { WebApiClient } from "../../api/useWebApiClient";
import type {
  UniverseBackup,
  UniverseDiarySourceOption,
  UniverseNode,
  UniverseNodeCreateInput,
  UniverseReadResult,
  UniverseRelation,
  UniverseRelationCreateInput,
  UniverseRevision,
  UniverseSnapshot,
} from "./universe-types";

type ApiEnvelope<T> = { success: true; data: T };

export type UniverseAdapter = {
  loadUniverse(): Promise<UniverseReadResult>;
  saveUniverse(value: UniverseSnapshot, expectedVersion: number): Promise<UniverseReadResult>;
  createNode(value: UniverseNodeCreateInput, expectedVersion: number, sourceDiaryIds?: string[]): Promise<UniverseReadResult>;
  updateNode(nodeId: string, patch: Partial<UniverseNode>, reason: string, expectedVersion: number, sourceDiaryIds?: string[]): Promise<UniverseReadResult>;
  searchDiarySourceOptions(query: string): Promise<UniverseDiarySourceOption[]>;
  deleteNode(nodeId: string, expectedVersion: number): Promise<UniverseReadResult>;
  createRelation(value: UniverseRelationCreateInput, expectedVersion: number): Promise<UniverseReadResult>;
  deleteRelation(relationId: string, expectedVersion: number): Promise<UniverseReadResult>;
  latestRevision(nodeId: string): Promise<UniverseRevision>;
  restoreLatestRevision(nodeId: string, expectedVersion: number): Promise<UniverseReadResult>;
  createBackup(reason: string): Promise<UniverseBackup>;
  latestBackup(): Promise<UniverseBackup | null>;
  ensureDailyBackup(): Promise<UniverseBackup | null>;
  restoreBackup(backupId: string, expectedVersion: number): Promise<UniverseReadResult>;
};

function createRemoteUniverseAdapter(api: WebApiClient): UniverseAdapter {
  const read = <T>(path: string, init?: RequestInit) =>
    api.request<ApiEnvelope<T>>(path, init).then((response) => response.data);
  const json = (body: unknown): RequestInit => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    loadUniverse: () => read<UniverseReadResult>("/universe"),
    saveUniverse: (snapshot, expectedVersion) =>
      read<UniverseReadResult>("/universe", { method: "PUT", ...json({ snapshot, expected_version: expectedVersion }) }),
    createNode: (node, expectedVersion, sourceDiaryIds) =>
      read<UniverseReadResult>("/universe/nodes", { method: "POST", ...json({ node, ...(sourceDiaryIds === undefined ? {} : { source_diary_ids: sourceDiaryIds }), expected_version: expectedVersion }) }),
    updateNode: (nodeId, patch, reason, expectedVersion, sourceDiaryIds) =>
      read<UniverseReadResult>(`/universe/nodes/${encodeURIComponent(nodeId)}`, { method: "PATCH", ...json({ patch, ...(sourceDiaryIds === undefined ? {} : { source_diary_ids: sourceDiaryIds }), reason, expected_version: expectedVersion }) }),
    searchDiarySourceOptions: (query) => read<UniverseDiarySourceOption[]>(`/universe/diary-source-options?q=${encodeURIComponent(query)}`),
    deleteNode: (nodeId, expectedVersion) =>
      read<UniverseReadResult>(`/universe/nodes/${encodeURIComponent(nodeId)}`, { method: "DELETE", ...json({ expected_version: expectedVersion }) }),
    createRelation: (relation, expectedVersion) =>
      read<UniverseReadResult>("/universe/relations", { method: "POST", ...json({ relation, expected_version: expectedVersion }) }),
    deleteRelation: (relationId, expectedVersion) =>
      read<UniverseReadResult>(`/universe/relations/${encodeURIComponent(relationId)}`, { method: "DELETE", ...json({ expected_version: expectedVersion }) }),
    latestRevision: (nodeId) => read<UniverseRevision>(`/universe/nodes/${encodeURIComponent(nodeId)}/revisions/latest`),
    restoreLatestRevision: (nodeId, expectedVersion) =>
      read<UniverseReadResult>(`/universe/nodes/${encodeURIComponent(nodeId)}/revisions/restore`, { method: "POST", ...json({ expected_version: expectedVersion }) }),
    createBackup: (reason) => read<UniverseBackup>("/universe/backups", { method: "POST", ...json({ reason }) }),
    latestBackup: () => read<UniverseBackup>("/universe/backups/latest").catch((error: unknown) => {
      if ((error as { code?: unknown })?.code === "BACKUP_NOT_FOUND") return null;
      throw error;
    }),
    ensureDailyBackup: () => read<UniverseBackup | null>("/universe/backups/daily", { method: "POST", ...json({}) }),
    restoreBackup: (backupId, expectedVersion) =>
      read<UniverseReadResult>(`/universe/backups/${encodeURIComponent(backupId)}/restore`, { method: "POST", ...json({ expected_version: expectedVersion }) }),
  };
}

/** Remote implementation of the frozen standalone UniverseAdapter contract. */
export class LeileiOSAdapter implements UniverseAdapter {
  private readonly delegate: UniverseAdapter;

  constructor(api: WebApiClient) {
    this.delegate = createRemoteUniverseAdapter(api);
  }

  loadUniverse() { return this.delegate.loadUniverse(); }
  saveUniverse(value: UniverseSnapshot, expectedVersion: number) { return this.delegate.saveUniverse(value, expectedVersion); }
  createNode(value: UniverseNodeCreateInput, expectedVersion: number, sourceDiaryIds?: string[]) { return this.delegate.createNode(value, expectedVersion, sourceDiaryIds); }
  updateNode(nodeId: string, patch: Partial<UniverseNode>, reason: string, expectedVersion: number, sourceDiaryIds?: string[]) { return this.delegate.updateNode(nodeId, patch, reason, expectedVersion, sourceDiaryIds); }
  searchDiarySourceOptions(query: string) { return this.delegate.searchDiarySourceOptions(query); }
  deleteNode(nodeId: string, expectedVersion: number) { return this.delegate.deleteNode(nodeId, expectedVersion); }
  createRelation(value: UniverseRelationCreateInput, expectedVersion: number) { return this.delegate.createRelation(value, expectedVersion); }
  deleteRelation(relationId: string, expectedVersion: number) { return this.delegate.deleteRelation(relationId, expectedVersion); }
  latestRevision(nodeId: string) { return this.delegate.latestRevision(nodeId); }
  restoreLatestRevision(nodeId: string, expectedVersion: number) { return this.delegate.restoreLatestRevision(nodeId, expectedVersion); }
  createBackup(reason: string) { return this.delegate.createBackup(reason); }
  latestBackup() { return this.delegate.latestBackup(); }
  ensureDailyBackup() { return this.delegate.ensureDailyBackup(); }
  restoreBackup(backupId: string, expectedVersion: number) { return this.delegate.restoreBackup(backupId, expectedVersion); }
}

export function createLeileiOSUniverseAdapter(api: WebApiClient): UniverseAdapter {
  return new LeileiOSAdapter(api);
}

export const createUniverseAdapter = createLeileiOSUniverseAdapter;
