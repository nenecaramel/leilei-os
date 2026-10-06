import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NativeLiveRuntimeExecutionResult } from "../protocol/native-live-runtime-protocol.js";

export type NativeLivePendingResult = {
  listenerInstanceId: string;
  reservationId: string;
  result: NativeLiveRuntimeExecutionResult;
};

/** Persist before HTTP; retain the original reservation owner across daemon restarts. */
export class NativeLiveMacResultOutbox {
  constructor(private readonly directory: string) {}

  async save(entry: NativeLivePendingResult): Promise<void> {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(entry);
    const body = JSON.stringify(entry);
    if (existsSync(path)) {
      if (readFileSync(path, "utf8") !== body) throw new Error("Conflicting terminal result in outbox.");
      return;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, body);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temporary, path);
    this.syncDirectory();
  }

  async list(): Promise<NativeLivePendingResult[]> {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name)).sort().map((name) => {
      const entry = JSON.parse(readFileSync(join(this.directory, name), "utf8")) as NativeLivePendingResult;
      if (!entry.listenerInstanceId || !entry.reservationId || entry.result?.prepare_id !== entry.reservationId || this.path(entry) !== join(this.directory, name)) {
        throw new Error("Invalid terminal result outbox record.");
      }
      return entry;
    });
  }

  async acknowledge(entry: NativeLivePendingResult): Promise<void> {
    unlinkSync(this.path(entry));
    this.syncDirectory();
  }

  private path(entry: NativeLivePendingResult): string {
    const identity = createHash("sha256").update(JSON.stringify([entry.listenerInstanceId, entry.reservationId])).digest("hex");
    return join(this.directory, `${identity}.json`);
  }

  private syncDirectory(): void {
    const fd = openSync(this.directory, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
}
