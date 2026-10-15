import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { backgroundIdentity, backgroundResult, type NativeLiveBackgroundPrepare, type NativeLiveBackgroundSubmit, type NativeLiveBackgroundPrepared, type NativeLiveBackgroundAck } from "../protocol/native-live-background-result.js";
import { requireUuid } from "../protocol/runtime-protocol/parsing.js";
import type { NativeLiveMacPersistentAcknowledgement, NativeLiveMacPersistentBackgroundOwner } from "./native-live-mac-persistent-turn-router.js";
import type { NativeLiveMacPersistentSessionOptions } from "./native-live-mac-claude-transport.js";

type Entry = NativeLiveBackgroundSubmit & { parentProviderCheckpointId: string };
type Relay = {
  prepareBackgroundResult(input: NativeLiveBackgroundPrepare): Promise<NativeLiveBackgroundPrepared>;
  submitBackgroundResult(input: NativeLiveBackgroundSubmit): Promise<NativeLiveBackgroundAck>;
};
type Frame = Parameters<NativeLiveMacPersistentSessionOptions["onBackgroundResult"]>[0] & { providerCheckpointId: string };
function entry(value: Entry): Entry {
  const identity = backgroundIdentity(value), result = backgroundResult(value.result);
  if (result.prepare_id !== identity.sourcePrepareId) throw new Error("Background receipt source mismatch.");
  return { ...identity, parentProviderCheckpointId: requireUuid(value.parentProviderCheckpointId, "parentProviderCheckpointId"), result };
}

/** Separate from foreground terminal results: each background frame owns a receipt. */
export class NativeLiveMacBackgroundResultOutbox {
  constructor(private readonly directory: string) {}
  async save(raw: Entry): Promise<void> {
    const value = entry(raw), body = JSON.stringify(value);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(value);
    if (existsSync(path)) {
      if (lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== body) throw new Error("Conflicting background receipt.");
      return;
    }
    const temporary = `${path}.${randomUUID()}.tmp`, fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path); this.sync();
  }
  async list(): Promise<Entry[]> {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().map(name => {
      const path = join(this.directory, name);
      if (lstatSync(path).isSymbolicLink()) throw new Error("Invalid background receipt file.");
      const value = entry(JSON.parse(readFileSync(path, "utf8")) as Entry);
      if (this.path(value) !== path) throw new Error("Invalid background receipt identity.");
      return value;
    });
  }
  async acknowledge(raw: Entry): Promise<void> {
    const value = entry(raw), path = this.path(value);
    if (!existsSync(path)) return;
    if (lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== JSON.stringify(value)) throw new Error("Conflicting background receipt acknowledgement.");
    unlinkSync(path); this.sync();
  }
  private path(value: Entry): string {
    return join(this.directory, createHash("sha256").update(JSON.stringify([value.listenerInstanceId, value.generationId, value.receiptId])).digest("hex") + ".json");
  }
  private sync(): void { const fd = openSync(this.directory, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
}

export class NativeLiveMacBackgroundResultSink {
  private queue = Promise.resolve();
  constructor(private readonly input: { listenerInstanceId: string; relay: Relay; outbox: NativeLiveMacBackgroundResultOutbox }) {}
  async commit(owner: NativeLiveMacPersistentBackgroundOwner, frame: Frame): Promise<NativeLiveMacPersistentAcknowledgement> {
    if (!owner.source || !owner.parentProviderCheckpointId || !owner.providerSessionId || !isAbsolute(owner.workingDirectory)) throw new Error("No committed background source is available.");
    const pending = entry({ sourcePrepareId: owner.source.prepareId, receiptId: randomUUID(), listenerInstanceId: this.input.listenerInstanceId,
      generationId: owner.generationId, parentProviderCheckpointId: owner.parentProviderCheckpointId,
      result: { protocol_version: 4, prepare_id: owner.source.prepareId, request_id: owner.source.requestId, conversation_id: owner.conversationId,
        status: "success", provider_session_id: owner.providerSessionId, effective_working_directory: owner.workingDirectory,
        provider_checkpoint_id: frame.providerCheckpointId, normalized_events: frame.normalizedEvents } });
    return this.serial(async () => {
      await this.input.outbox.save(pending); // Preserve identity before either HTTP response can be lost.
      const ack = await this.deliver(pending);
      return ack.outcome === "committed"
        ? { status: ack.duplicate ? "idempotent" : "applied", providerCheckpointId: ack.providerCheckpointId! }
        : { status: "rejected" };
    });
  }
  /** Re-deliver immutable receipts after a restart; never restart provider work. */
  async flush(): Promise<number> {
    return this.serial(async () => {
      let settled = 0;
      for (const value of (await this.input.outbox.list()).slice(0, 16)) { await this.deliver(value); settled++; }
      return settled;
    });
  }
  private async deliver(value: Entry): Promise<NativeLiveBackgroundAck> {
    const prepared = await this.input.relay.prepareBackgroundResult(value);
    if (value.result.status !== "success" || prepared.receiptId !== value.receiptId || prepared.providerSessionId !== value.result.provider_session_id
      || prepared.parentProviderCheckpointId !== value.parentProviderCheckpointId) throw new Error("Background preparation binding changed.");
    const ack = await this.input.relay.submitBackgroundResult(value);
    if (!["committed", "stale", "failed"].includes(ack.outcome) || (ack.outcome === "committed"
      ? ack.providerCheckpointId !== value.result.provider_checkpoint_id : ack.providerCheckpointId !== null)) throw new Error("Background acknowledgement binding changed.");
    await this.input.outbox.acknowledge(value);
    return ack;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.then(() => {}, () => {}); return result;
  }
}
