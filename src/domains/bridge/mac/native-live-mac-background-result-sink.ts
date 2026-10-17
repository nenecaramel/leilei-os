import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { backgroundIdentity, backgroundResult, type NativeLiveBackgroundPrepare, type NativeLiveBackgroundSubmit, type NativeLiveBackgroundPrepared, type NativeLiveBackgroundAck } from "../protocol/native-live-background-result.js";
import { requireUuid } from "../protocol/runtime-protocol/parsing.js";
import type { NativeLiveMacPersistentAcknowledgement, NativeLiveMacPersistentBackgroundOwner } from "./native-live-mac-persistent-turn-router.js";
import type { NativeLiveMacPersistentSessionOptions } from "./native-live-mac-claude-transport.js";

type Entry = NativeLiveBackgroundSubmit & { parentProviderCheckpointId: string; executionStart?: boolean; deferred?: boolean };
type Relay = {
  prepareBackgroundResult(input: NativeLiveBackgroundPrepare): Promise<NativeLiveBackgroundPrepared>;
  submitBackgroundResult(input: NativeLiveBackgroundSubmit): Promise<NativeLiveBackgroundAck>;
};
type Frame = Parameters<NativeLiveMacPersistentSessionOptions["onBackgroundResult"]>[0] & { providerCheckpointId: string };
class NativeBackgroundStaleReceipt extends Error {
  readonly relayCode = "BACKGROUND_STALE";
  constructor() { super("Background result was rejected as stale; retained for manual recovery."); }
}

function entry(value: Entry): Entry {
  const identity = backgroundIdentity(value), result = backgroundResult(value.result);
  if (result.prepare_id !== identity.sourcePrepareId) throw new Error("Background receipt source mismatch.");
  return { ...identity, parentProviderCheckpointId: requireUuid(value.parentProviderCheckpointId, "parentProviderCheckpointId"),
    ...(value.executionStart === true ? { executionStart: true } : {}),
    ...(value.deferred === true ? { deferred: true } : {}),
    ...(value.coveringCheckpointId ? { coveringCheckpointId: requireUuid(value.coveringCheckpointId, "coveringCheckpointId") } : {}), result };
}

/** Separate from foreground terminal results: each background frame owns a receipt. */
export class NativeLiveMacBackgroundResultOutbox {
  constructor(private readonly directory: string) {}

  // The digest in an outbox filename is an identity, NOT a sequence.
  // Persist writer order independently so recovery cannot reorder adjacent
  // native SDK outputs across a process restart.
  private get orderPath(): string { return join(this.directory, ".delivery-order.json"); }
  private order(): string[] {
    // The index can lag behind a receipt whose file was fsynced and renamed
    // before the index update crashed. Reconcile existing files on EVERY read,
    // including save(): otherwise saving B2 could persist [B2] while orphaned
    // B1 survives outside the index and replays after B2.
    if (!existsSync(this.directory)) return [];
    const disk = readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const birthtime = new Map(disk.map(name => {
      const stat = lstatSync(join(this.directory, name));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid background receipt file.");
      return [name, stat.birthtimeMs] as const;
    }));
    let journal: string[] = [];
    if (existsSync(this.orderPath)) {
      if (!lstatSync(this.orderPath).isFile() || lstatSync(this.orderPath).isSymbolicLink())
        throw new Error("Invalid background delivery-order index.");
      const data: unknown = JSON.parse(readFileSync(this.orderPath, "utf8"));
      if (!Array.isArray(data) || !data.every(v => typeof v === "string" && /^[a-f0-9]{64}\.json$/.test(v))
        || new Set(data).size !== data.length) throw new Error("Corrupt background delivery-order index.");
      journal = data;
    }
    const indexed = new Set(journal);
    // An indexed receipt's prior order is authoritative. Newly discovered
    // orphans are unindexed only because their journal rename was interrupted;
    // recover them in filesystem creation order, never hash filename order.
    const orphaned = disk.filter(name => !indexed.has(name))
      .sort((a,b) => birthtime.get(a)! - birthtime.get(b)! || a.localeCompare(b));
    return [...journal.filter(name => birthtime.has(name)), ...orphaned];
  }
  private persistOrder(order: string[]): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.orderPath}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(order)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, this.orderPath);
    this.sync();
  }
  async save(raw: Entry): Promise<void> {
    const value = entry(raw), body = JSON.stringify(value);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(value), name = basename(path);
    const ordered = this.order();
    if (existsSync(path)) {
      if (lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== body) throw new Error("Conflicting background receipt.");
    } else {
      const temporary = `${path}.${randomUUID()}.tmp`, fd = openSync(temporary, "wx", 0o600);
      try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, path); this.sync();
    }
    if (!ordered.includes(name)) ordered.push(name);
    // Even a preexisting identical orphan is indexed before acknowledging
    // save. If this write fails the original receipt remains on disk.
    this.persistOrder(ordered);
  }
  /** Record the verified foreground descendant before transmitting the
   * foreground result. A crash cannot leave a committed F without the B=>F
   * coverage evidence if this write is required before that commit. */
  async cover(conversationId: string, generationId: string, coveringCheckpointId: string): Promise<number> {
    const covering = requireUuid(coveringCheckpointId, "coveringCheckpointId");
    let updated = 0;
    for (const original of await this.list()) {
      if (original.result.conversation_id !== conversationId || original.generationId !== generationId || original.deferred !== true) continue;
      if (original.coveringCheckpointId) {
        if (original.coveringCheckpointId !== covering) throw new Error("Conflicting background covering checkpoint.");
        continue;
      }
      const replacement = entry({ ...original, coveringCheckpointId: covering });
      const path = this.path(original);
      if (lstatSync(path).isSymbolicLink() || readFileSync(path,"utf8") !== JSON.stringify(original))
        throw new Error("Concurrent background outbox mutation.");
      const temp = `${path}.${randomUUID()}.tmp`, fd=openSync(temp,"wx",0o600);
      try { writeFileSync(fd,JSON.stringify(replacement)); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temp,path); this.sync();
      updated++;
    }
    return updated;
  }

  listSync(): Entry[] { return this.listDirectory(this.directory); }
  listQuarantinedSync(): Entry[] { return this.listDirectory(join(this.directory,"blocked")); }
  async list(): Promise<Entry[]> { return this.listSync(); }
  async listQuarantined(): Promise<Entry[]> { return this.listQuarantinedSync(); }
  private listDirectory(directory: string): Entry[] {
    if (!existsSync(directory)) return [];
    const names = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    let ordered = names.sort();
    if (directory === this.directory) {
      // order() also reconciles unindexed fsynced receipts. Never re-sort
      // recovered entries by their randomly hashed filenames.
      ordered = this.order();
    }
    return ordered.map(name => {
      const path = join(directory, name);
      if (lstatSync(path).isSymbolicLink()) throw new Error("Invalid background receipt file.");
      const value = entry(JSON.parse(readFileSync(path, "utf8")) as Entry);
      if (basename(this.path(value)) !== name) throw new Error("Invalid background receipt identity.");
      return value;
    });
  }
  async quarantine(raw: Entry): Promise<void> {
    const value=entry(raw),source=this.path(value),directory=join(this.directory,"blocked");
    if(lstatSync(source).isSymbolicLink()||readFileSync(source,"utf8")!==JSON.stringify(value))throw new Error("Conflicting recovery evidence.");
    const ordered = this.order().filter(name => name !== basename(source));
    mkdirSync(directory,{recursive:true,mode:0o700});
    const target=join(directory,basename(source));
    if(existsSync(target))throw new Error("Conflicting quarantined receipt.");
    renameSync(source,target);
    const fd=openSync(directory,"r");try{fsyncSync(fd);}finally{closeSync(fd);}this.sync();
    this.persistOrder(ordered);
  }
  async acknowledge(raw: Entry): Promise<void> {
    const value = entry(raw), path = this.path(value);
    const ordered = this.order().filter(name => name !== basename(path));
    if (existsSync(path)) {
      if (lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== JSON.stringify(value)) throw new Error("Conflicting background receipt acknowledgement.");
      unlinkSync(path); this.sync();
    }
    this.persistOrder(ordered);
  }
  private path(value: Entry): string {
    return join(this.directory, createHash("sha256").update(JSON.stringify([value.listenerInstanceId, value.generationId, value.receiptId])).digest("hex") + ".json");
  }
  private sync(): void { const fd = openSync(this.directory, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
}

export class NativeLiveMacBackgroundResultSink {
  private queue = Promise.resolve();
  private readonly retryAfter = new Map<string,number>();
  constructor(private readonly input: { listenerInstanceId: string; relay: Relay; outbox: NativeLiveMacBackgroundResultOutbox;
    now?:()=>number; isForegroundActive?(conversationId:string):boolean;
    onImmediateFence?(conversationId:string):void;
    onRecoveryBlocked?(conversationId:string):Promise<void>; onRecovered?(conversationId:string):Promise<void>;
  }) {}
  async commit(owner: NativeLiveMacPersistentBackgroundOwner, frame: Frame): Promise<NativeLiveMacPersistentAcknowledgement> {
    if (!owner.source || !owner.parentProviderCheckpointId || !owner.providerSessionId || !isAbsolute(owner.workingDirectory)) throw new Error("No committed background source is available.");
    const pending = entry({ sourcePrepareId: owner.source.prepareId, receiptId: randomUUID(), listenerInstanceId: this.input.listenerInstanceId,
      generationId: owner.generationId, parentProviderCheckpointId: owner.parentProviderCheckpointId,
      ...(owner.executionStart === true ? { executionStart: true } : {}),
      ...(owner.deferred === true ? { deferred: true } : {}),
      result: { protocol_version: 4, prepare_id: owner.source.prepareId, request_id: owner.source.requestId, conversation_id: owner.conversationId,
        status: "success", provider_session_id: owner.providerSessionId, effective_working_directory: owner.workingDirectory,
        provider_checkpoint_id: frame.providerCheckpointId, normalized_events: frame.normalizedEvents } });
    return this.serial(async () => {
      await this.input.outbox.save(pending); // Preserve identity before either HTTP response can be lost.
      try {
        const ack = await this.deliver(pending);
        return ack.outcome === "queued"
          ? { status: "queued", providerCheckpointId: frame.providerCheckpointId }
          : ack.outcome === "committed"
            ? { status: ack.duplicate ? "idempotent" : "applied", providerCheckpointId: ack.providerCheckpointId! }
            : { status: "rejected" };
      } catch (error) {
        // No asynchronous retirement from inside this ACK lock. Suspended
        // dispatch is synchronous, so a foreground send cannot slip in
        // before the next periodic recovery flush observes the saved receipt.
        this.input.onImmediateFence?.(pending.result.conversation_id);
        if (error instanceof NativeBackgroundStaleReceipt) {
          // Never lose a generated result just because the backend rejected its
          // old parent. Quarantine the immutable evidence and fence this
          // conversation; the SDK writer must not treat it as a committed turn.
          await this.input.outbox.quarantine(pending);
          // Do not await onRecoveryBlocked here: the Mac runtime's callback
          // retires the same persistent writer and waits for its outstanding
          // acknowledgement, which is *this* commit. That self-wait deadlocks.
          // The daemon recovery pass observes quarantined records and fences
          // the conversation after this acknowledgement unwinds.
        }
        throw error;
      }
    });
  }
  /** Publish the exact covered segment order before the next foreground input
   * can use this writer. An unknown/queued ACK is not considered delivered. */
  async publishCovered(conversationId: string, generationId: string): Promise<void> {
    await this.serial(async () => {
      const pending = (await this.input.outbox.list()).filter(value =>
        value.result.conversation_id === conversationId && value.generationId === generationId
        && value.deferred === true && Boolean(value.coveringCheckpointId));
      for (const value of pending) {
        try {
          const ack = await this.deliver(value);
          if (ack.outcome !== "committed") throw new Error("Deferred background result is not canonically published.");
        } catch (error) {
          this.input.onImmediateFence?.(conversationId);
          throw error;
        }
      }
    });
  }
  async cover(conversationId: string, generationId: string, coveringCheckpointId: string): Promise<number> {
    return this.serial(() => this.input.outbox.cover(conversationId, generationId, coveringCheckpointId));
  }
  /** Synchronous failure fence: a foreground exception can occur before
   * coverage was ever journaled, while B remains queued on disk. */
  hasUnpublishedDeferred(conversationId: string, generationId: string): boolean {
    return this.input.outbox.listSync().some(value =>
      value.result.conversation_id === conversationId
      && value.generationId === generationId && value.deferred === true);
  }

  /** Re-deliver immutable receipts after a restart; never restart provider work.
   * Never invoke writer retirement/recovery callbacks while holding the sink's
   * serial delivery lock: router.settle() can wait for an ACK queued behind
   * that lock. All fencing happens after the operation has left the queue. */
  async flush(): Promise<number> {
    const blocked = new Set<string>();
    const recovered = new Set<string>();
    const settled = await this.serial(async () => {
      let completed = 0;
      const quarantined = await this.input.outbox.listQuarantined();
      for (const value of quarantined) blocked.add(value.result.conversation_id);
      const waiting = (await this.input.outbox.list()).filter(
        v => v.deferred === true && !v.coveringCheckpointId,
      );
      for (const value of waiting) {
        if (!this.input.isForegroundActive?.(value.result.conversation_id))
          blocked.add(value.result.conversation_id);
      }
      const now = (this.input.now ?? Date.now)();
      const value = (await this.input.outbox.list()).find(v =>
        (!v.deferred || v.coveringCheckpointId)
        // F may have fsynced its covering proof but not yet committed. Only
        // its post-commit drain may publish B while that writer is active.
        && !(v.deferred && this.input.isForegroundActive?.(v.result.conversation_id))
        && (this.retryAfter.get(v.receiptId) ?? 0) <= now
      );
      if (!value) return completed;
      try {
        const ack = await this.deliver(value);
        // A queued receipt is not completed transport and must never count
        // as an acknowledged/visible message.
        if (ack.outcome !== "committed" && ack.outcome !== "failed")
          throw new Error("Background recovery did not finalize its receipt.");
        completed++;
        this.retryAfter.delete(value.receiptId);
        if (![...quarantined, ...await this.input.outbox.list()].some(
          v => v.result.conversation_id === value.result.conversation_id,
        )) recovered.add(value.result.conversation_id);
      } catch (error) {
        this.retryAfter.set(value.receiptId, now + 30_000);
        blocked.add(value.result.conversation_id);
        const code = error && typeof error === "object" && "relayCode" in error
          ? error.relayCode : null;
        if (code === "BACKGROUND_CONFLICT" || code === "BACKGROUND_NOT_FOUND"
          || code === "BACKGROUND_STALE") await this.input.outbox.quarantine(value);
      }
      return completed;
    });
    // Release the serial delivery lock *before* either callback may close or
    // settle the current persistent writer. A background commit queued while
    // we were flushing is free to finish before any recovery retirement.
    for (const conversationId of blocked)
      await this.input.onRecoveryBlocked?.(conversationId).catch(() => {});
    for (const conversationId of recovered) {
      if (!blocked.has(conversationId))
        await this.input.onRecovered?.(conversationId).catch(() => {});
    }
    return settled;
  }
  private async deliver(value: Entry): Promise<NativeLiveBackgroundAck> {
    const prepared = await this.input.relay.prepareBackgroundResult(value);
    if (value.result.status !== "success" || prepared.receiptId !== value.receiptId || prepared.providerSessionId !== value.result.provider_session_id
      || prepared.parentProviderCheckpointId !== value.parentProviderCheckpointId) throw new Error("Background preparation binding changed.");
    const ack = await this.input.relay.submitBackgroundResult(value);
    if (!["committed", "queued", "stale", "failed"].includes(ack.outcome) || (ack.outcome === "committed"
      ? ack.providerCheckpointId !== (value.coveringCheckpointId ?? value.result.provider_checkpoint_id)
      : ack.providerCheckpointId !== null)) throw new Error("Background acknowledgement binding changed.");
    if (ack.outcome === "stale") {
      // An HTTP 200 with outcome=stale did not deliver the reply. Deleting its
      // outbox record here permanently loses the only recoverable output.
      throw new NativeBackgroundStaleReceipt();
    }
    if (ack.outcome === "queued") {
      if (!value.deferred || value.coveringCheckpointId)
        throw new Error("Unexpected queued reply outside a pre-coverage native foreground; retain outbox.");
      return ack; // Uncovered native producer is durable, not canonically published.
    }
    await this.input.outbox.acknowledge(value);
    return ack;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.then(() => {}, () => {}); return result;
  }
}
