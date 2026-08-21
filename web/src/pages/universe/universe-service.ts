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

export class UniverseInitializationError extends Error {
  constructor(readonly code: "UNIVERSE_IMPORT_NOT_WRITTEN" | "UNIVERSE_IMPORT_UNCERTAIN" | "UNIVERSE_IMPORT_ALREADY_INITIALIZED") {
    super(code);
    this.name = "UniverseInitializationError";
  }
}

export function createLeileiOSUniverseService({ adapter }: { adapter: UniverseAdapter }) {
  let state: UniverseClientState = null;
  const set = (result: UniverseReadResult) => {
    state = { ...result, sources: result.sources ?? state?.sources ?? [] };
    return state;
  };
  const setMutation = async (result: UniverseReadResult) => {
    if (result.sources !== undefined) return set(result);
    try {
      return set(await adapter.loadUniverse());
    } catch {
      return set(result);
    }
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
      return setMutation(await adapter.saveUniverse(snapshot, expected()));
    },
    async initializeUniverse(snapshot: UniverseSnapshot) {
      try {
        const existing = await adapter.loadUniverse();
        if (existing) throw new UniverseInitializationError("UNIVERSE_IMPORT_ALREADY_INITIALIZED");
      } catch (error) {
        if (error instanceof UniverseInitializationError) throw error;
        if (!isUniverseNotInitialized(error)) throw new UniverseInitializationError("UNIVERSE_IMPORT_UNCERTAIN");
      }
      let writeFailed = false;
      try {
        await adapter.saveUniverse(snapshot, 0);
      } catch {
        writeFailed = true;
      }
      try {
        const fresh = set(await adapter.loadUniverse());
        return { state: fresh, writeFailed };
      } catch (readError) {
        if (writeFailed && isUniverseNotInitialized(readError)) {
          throw new UniverseInitializationError("UNIVERSE_IMPORT_NOT_WRITTEN");
        }
        throw new UniverseInitializationError("UNIVERSE_IMPORT_UNCERTAIN");
      }
    },
    async createNode(node: UniverseNodeCreateInput, sourceDiaryIds: string[] = []) {
      return setMutation(await adapter.createNode(node, expected(), sourceDiaryIds));
    },
    async updateNode(nodeId: string, patch: Partial<UniverseNode>, reason = "认知内容更新", sourceDiaryIds?: string[]) {
      return setMutation(await adapter.updateNode(nodeId, patch, reason, expected(), sourceDiaryIds));
    },
    async searchDiarySourceOptions(query: string) {
      return adapter.searchDiarySourceOptions(query);
    },
    async deleteNode(nodeId: string) {
      return setMutation(await adapter.deleteNode(nodeId, expected()));
    },
    async createRelation(relation: UniverseRelationCreateInput) {
      return setMutation(await adapter.createRelation(relation, expected()));
    },
    async deleteRelation(relationId: string) {
      return setMutation(await adapter.deleteRelation(relationId, expected()));
    },
    async latestRevision(nodeId: string): Promise<UniverseRevision> {
      return adapter.latestRevision(nodeId);
    },
    async restoreLatestRevision(nodeId: string) {
      return setMutation(await adapter.restoreLatestRevision(nodeId, expected()));
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
      return setMutation(await adapter.restoreBackup(backupId, expected()));
    },
    async createEdge(relation: UniverseRelationCreateInput) {
      return setMutation(await adapter.createRelation(relation, expected()));
    },
    async deleteEdge(relationId: string) {
      return setMutation(await adapter.deleteRelation(relationId, expected()));
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
