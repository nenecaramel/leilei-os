import type { LocalRitrieveBreathSemanticScorer } from "../../runtime/breath/local-ritrieve-embedding.js";

const PAGE_SIZE = 128;
const MAX_ROWS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 6000;

export class MacMindSnapshotSync {
  private lastVersion: string | null = null;
  private pending: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly index: Pick<LocalRitrieveBreathSemanticScorer, "replaceSnapshot" | "isSnapshotReady">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    const job = this.sync();
    this.pending = job;
    void job.finally(() => {
      if (this.pending === job) this.pending = null;
    }).catch(() => undefined);
    return job;
  }

  private async sync(): Promise<void> {
    let version: string | null = null;
    let total: number | null = null;
    let offset = 0;
    const memories: {stateId: string; text: string}[] = [];
    const baseUrl = this.baseUrl.replace(/\/+$/, "");
    for (;;) {
      const url = `${baseUrl}/internal/mind/snapshot?offset=${offset}`;
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
        headers: {authorization: `Bearer ${this.token}`, "cache-control": "no-store"},
      });
      if (!response.ok) throw new Error("Mind snapshot unavailable.");
      const envelope: unknown = await response.json();
      if (!envelope || typeof envelope !== "object" || !("success" in envelope) ||
        envelope.success !== true || !("data" in envelope)) throw new Error("Invalid snapshot envelope.");
      const data = envelope.data;
      if (!data || typeof data !== "object" || !("version" in data) || !("total" in data) ||
        !("memories" in data) || !("next_offset" in data) ||
        typeof data.version !== "string" || !/^[a-f0-9]{64}$/.test(data.version) ||
        (typeof data.total !== "number" || !Number.isInteger(data.total)) || (data.total as number) < 0 ||
        (data.total as number) > MAX_ROWS || !Array.isArray(data.memories) ||
        data.memories.length > PAGE_SIZE) throw new Error("Invalid snapshot metadata.");
      if (version !== null && version !== data.version) throw new Error("Memory snapshot changed during sync.");
      if (total !== null && total !== data.total) throw new Error("Memory snapshot count changed.");
      version = data.version;
      total = data.total as number;
      if (version === this.lastVersion && this.index.isSnapshotReady()) return;
      for (const row of data.memories) {
        if (!row || typeof row !== "object" || typeof row.stateId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(row.stateId) ||
          typeof row.text !== "string" || !row.text.trim() ||
          row.text.length > 2_000) throw new Error("Invalid snapshot record.");
        memories.push({stateId: row.stateId, text: row.text});
      }
      if (memories.length > MAX_ROWS || memories.length > total) throw new Error("Snapshot size mismatch.");
      const next = data.next_offset;
      if (next === null) {
        if (memories.length !== total) throw new Error("Incomplete Mind snapshot.");
        break;
      }
      if (!Number.isInteger(next) || (next as number) !== offset + data.memories.length ||
        (next as number) <= offset || (next as number) > total) throw new Error("Invalid snapshot cursor.");
      offset = next as number;
    }
    if (version === null) throw new Error("Empty snapshot response.");
    if (new Set(memories.map(x => x.stateId)).size !== memories.length) {
      throw new Error("Duplicate Mind snapshot record.");
    }
    await this.index.replaceSnapshot({version, memories});
    this.lastVersion = version;
  }
}
