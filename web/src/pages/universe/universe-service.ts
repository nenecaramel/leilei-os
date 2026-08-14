import type { WebApiError } from "../../api/useWebApiClient";
import type {
  UniverseAdapter,
} from "./universe-adapter";
import type {
  UniverseBackup,
  UniverseNode,
  UniverseNodeCreateInput,
  UniverseReadResult,
  UniverseRelation,
  UniverseRelationCreateInput,
  UniverseRevision,
  UniverseSnapshot,
} from "./universe-types";

export type UniverseClientState = UniverseReadResult | null;

export type UniverseService = ReturnType<typeof createLeileiOSUniverseService>;

export function createLeileiOSUniverseService({ adapter }: { adapter: UniverseAdapter }) {
  let state: UniverseClientState = null;
  const set = (result: UniverseReadResult) => {
    state = { snapshot: result.snapshot, version: result.version };
    return state;
  };
  const expected = () => {
    if (!state) throw new Error("Universe 尚未初始化。");
    return state.version;
  };
  return {
    async load() {
      return set(await adapter.loadUniverse());
    },
    getState() {
      return state;
    },
    async saveUniverse(snapshot: UniverseSnapshot) {
      return set(await adapter.saveUniverse(snapshot, expected()));
    },
    async createNode(node: UniverseNodeCreateInput) {
      return set(await adapter.createNode(node, expected()));
    },
    async updateNode(nodeId: string, patch: Partial<UniverseNode>, reason = "认知内容更新") {
      return set(await adapter.updateNode(nodeId, patch, reason, expected()));
    },
    async deleteNode(nodeId: string) {
      return set(await adapter.deleteNode(nodeId, expected()));
    },
    async createRelation(relation: UniverseRelationCreateInput) {
      return set(await adapter.createRelation(relation, expected()));
    },
    async deleteRelation(relationId: string) {
      return set(await adapter.deleteRelation(relationId, expected()));
    },
    async latestRevision(nodeId: string): Promise<UniverseRevision> {
      return adapter.latestRevision(nodeId);
    },
    async restoreLatestRevision(nodeId: string) {
      return set(await adapter.restoreLatestRevision(nodeId, expected()));
    },
    async createBackup(reason = "手动恢复点"): Promise<UniverseBackup> {
      return adapter.createBackup(reason);
    },
    async latestBackup(): Promise<UniverseBackup | null> {
      return adapter.latestBackup();
    },
    async ensureDailyBackup(): Promise<UniverseBackup | null> {
      return adapter.ensureDailyBackup();
    },
    async restoreBackup(backupId: string) {
      return set(await adapter.restoreBackup(backupId, expected()));
    },
    async createEdge(relation: UniverseRelationCreateInput) {
      return set(await adapter.createRelation(relation, expected()));
    },
    async deleteEdge(relationId: string) {
      return set(await adapter.deleteRelation(relationId, expected()));
    },
    async exportData() {
      const current = state ?? set(await adapter.loadUniverse());
      return { ...current.snapshot, meta: { ...current.snapshot.meta, exportedAt: new Date().toISOString() } };
    },
    async importData() {
      throw new Error("Universe import is not available in LeileiOS mode.");
    },
  };
}

export const createUniverseService = createLeileiOSUniverseService;
export const LeileiOSUniverseService = createLeileiOSUniverseService;

export function isUniverseVersionConflict(error: unknown): boolean {
  return (error as WebApiError | undefined)?.code === "VERSION_CONFLICT";
}

export function isUniverseNotInitialized(error: unknown): boolean {
  return (error as WebApiError | undefined)?.code === "UNIVERSE_NOT_INITIALIZED";
}
