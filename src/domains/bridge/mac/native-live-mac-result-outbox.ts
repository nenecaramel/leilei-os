import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { NativeLiveRuntimeExecutionResult } from "../protocol/native-live-runtime-protocol.js";

export type NativeLivePendingResult = {
  listenerInstanceId: string;
  reservationId: string;
  result: NativeLiveRuntimeExecutionResult;
};

/** Persist before HTTP; retain the original reservation owner across daemon restarts. */
export class NativeLiveMacResultOutbox {
  private readonly directory: string;
  constructor(directory: string) {
    // macOS exposes these system temporary roots through standard aliases.
    // Normalize only those known roots; reject links in managed paths below.
    this.directory = process.platform === "darwin"
      ? resolve(directory).replace(/^\/(tmp|var)(?=\/|$)/u, "/private/$1")
      : resolve(directory);
  }

  async save(entry: NativeLivePendingResult): Promise<void> {
    this.assertSafeDirectory();
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.assertSafeDirectory();
    const path = this.path(entry);
    const body = JSON.stringify(entry);
    if (existsSync(path)) {
      if (this.readRecord(path) !== body) throw new Error("Conflicting terminal result in outbox.");
      return;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      writeFileSync(fd, body);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temporary, path);
    this.syncDirectory();
  }

  async list(): Promise<NativeLivePendingResult[]> {
    return this.readEntries(false);
  }

  /** Original evidence remains intact until verified recovery outside this loop. */
  async listQuarantined(): Promise<NativeLivePendingResult[]> {
    return this.readEntries(true);
  }

  async quarantine(entry: NativeLivePendingResult): Promise<void> {
    this.assertSafeDirectory();
    const path = this.path(entry);
    if (this.readRecord(path) !== JSON.stringify(entry)) throw new Error("Conflicting terminal result in outbox.");
    const destination = path.replace(/\.json$/u, ".quarantined.json");
    if (existsSync(destination) || this.isLink(destination)) throw new Error("Terminal result quarantine already exists.");
    // Same-directory rename retains the original bytes and is atomic. Sync the
    // directory before allowing unrelated work to proceed across a restart.
    renameSync(path, destination);
    this.syncDirectory();
  }

  private readEntries(quarantined: boolean): NativeLivePendingResult[] {
    this.assertSafeDirectory();
    if (!existsSync(this.directory)) return [];
    const suffix = quarantined ? ".quarantined.json" : ".json";
    const pattern = quarantined ? /^[a-f0-9]{64}\.quarantined\.json$/u : /^[a-f0-9]{64}\.json$/u;
    return readdirSync(this.directory).filter((name) => pattern.test(name)).sort().map((name) => {
      const entry = JSON.parse(this.readRecord(join(this.directory, name))) as NativeLivePendingResult;
      if (!entry.listenerInstanceId || !entry.reservationId || !entry.result?.conversation_id || entry.result.prepare_id !== entry.reservationId || this.path(entry).replace(/\.json$/u, suffix) !== join(this.directory, name)) {
        throw new Error("Invalid terminal result outbox record.");
      }
      return entry;
    });
  }

  async acknowledge(entry: NativeLivePendingResult): Promise<void> {
    this.assertSafeDirectory();
    if (this.readRecord(this.path(entry)) !== JSON.stringify(entry)) throw new Error("Conflicting terminal result in outbox.");
    unlinkSync(this.path(entry));
    this.syncDirectory();
  }

  private path(entry: NativeLivePendingResult): string {
    const identity = createHash("sha256").update(JSON.stringify([entry.listenerInstanceId, entry.reservationId])).digest("hex");
    return join(this.directory, `${identity}.json`);
  }

  private readRecord(path: string): string {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return readFileSync(fd, "utf8"); } finally { closeSync(fd); }
  }

  private isLink(path: string): boolean {
    try { return lstatSync(path).isSymbolicLink(); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private assertSafeDirectory(): void {
    for (let path = resolve(this.directory); ; path = dirname(path)) {
      if (this.isLink(path)) throw new Error("Terminal result outbox path must not contain symlinks.");
      if (dirname(path) === path) break;
    }
  }

  private syncDirectory(): void {
    const fd = openSync(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
}
