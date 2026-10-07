import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type NativeLivePendingClaudeHandoff = {
  listenerInstanceId: string;
  reservationId: string;
  handoffSessionId: string;
};

export class NativeLiveMacClaudeHandoffOutbox {
  constructor(private readonly directory: string) {}

  async save(
    entry: NativeLivePendingClaudeHandoff,
  ): Promise<void> {
    mkdirSync(this.directory, {
      recursive: true,
      mode: 0o700,
    });
    const path = this.path(entry);
    const body = JSON.stringify(entry);
    if (existsSync(path)) {
      if (readFileSync(path, "utf8") !== body) {
        throw new Error(
          "Conflicting Claude handoff receipt in outbox.",
        );
      }
      return;
    }

    const temporary =
      `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    this.syncDirectory();
  }

  async list(): Promise<
    NativeLivePendingClaudeHandoff[]
  > {
    if (!existsSync(this.directory)) {
      return [];
    }
    return readdirSync(this.directory)
      .filter((name) =>
        /^[a-f0-9]{64}\.json$/u.test(name)
      )
      .sort()
      .map((name) => {
        const entry = JSON.parse(
          readFileSync(
            join(this.directory, name),
            "utf8",
          ),
        ) as NativeLivePendingClaudeHandoff;

        if (
          !entry.listenerInstanceId
          || !entry.reservationId
          || !entry.handoffSessionId
          || this.path(entry)
            !== join(this.directory, name)
        ) {
          throw new Error(
            "Invalid Claude handoff outbox record.",
          );
        }
        return entry;
      });
  }

  async acknowledge(
    entry: NativeLivePendingClaudeHandoff,
  ): Promise<void> {
    unlinkSync(this.path(entry));
    this.syncDirectory();
  }

  private path(
    entry: NativeLivePendingClaudeHandoff,
  ): string {
    const identity = createHash("sha256")
      .update(JSON.stringify([
        entry.listenerInstanceId,
        entry.reservationId,
      ]))
      .digest("hex");
    return join(
      this.directory,
      `${identity}.json`,
    );
  }

  private syncDirectory(): void {
    const fd = openSync(this.directory, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
