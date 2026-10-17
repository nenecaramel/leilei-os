import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
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

  // The digest in an outbox filename is an identity, NOT a sequence.
  // Persist writer order independently so recovery cannot reorder adjacent
  // native SDK outputs across a process restart.
  private get orderPath(): string { return join(this.directory, ".delivery-order.json"); }
  private order(): string[] {
    if (existsSync(this.orderPath)) {
      if (lstatSync(this.orderPath).isSymbolicLink()) throw new Error("Invalid background delivery-order index.");
      const data: unknown = JSON.parse(readFileSync(this.orderPath, "utf8"));
      if (!Array.isArray(data) || !data.every(v => typeof v === "string" && /^[a-f0-9]{64}\\.json$/.test(v))
        || new Set(data).size !== data.length) throw new Error("Corrupt background delivery-order index.");
      return data;
    }
    // A pre-upgrade outbox has no order index. Recover its existing records
    // using recorded filesystem creation order instead of their random hashes.
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\\.json$/.test(name))
      .sort((a,b) => {
        const lhs = lstatSync(join(this.directory,a)).birthtimeMs;
        const rhs = lstatSync(join(this.directory,b)).birthtimeMs;
        return lhs - rhs || a.localeCompare(b);
      });
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
  async list(): Promise<Entry[]> { return this.listDirectory(this.directory); }
  async listQuarantined(): Promise<Entry[]> { return this.listDirectory(join(this.directory,"blocked")); }
  private listDirectory(directory: string): Entry[] {
    if (!existsSync(directory)) return [];
    const names = readdirSync(directory).filter(name => /^[a-f0-9]{64}\\.json$/.test(name));
    let ordered = names.sort();
    if (directory === this.directory) {
      const journal = this.order();
      const remaining = new Set(names);
      ordered = journal.filter(name => remaining.delete(name));
      // Recover an interrupted save (data fsynced, index not yet renamed).
      // Under the single-writer daemon lease, at most one newly saved
      // segment is unindexed at this interruption boundary.
      ordered.push(...[...remaining].sort());
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
    now?:()=>number; onRecoveryBlocked?(conversationId:string):Promise<void>; onRecovered?(conversationId:string):Promise<void>;
  }) {}
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
      const quarantined=await this.input.outbox.listQuarantined();
      for(const conversation of new Set(quarantined.map(v=>v.result.conversation_id)))await this.input.onRecoveryBlocked?.(conversation).catch(()=>{});
      const now=(this.input.now??Date.now)();
      // One bounded delivery per dispatch pass; a broken receipt must not
      // prevent unrelated foreground work from ever reaching the daemon loop.
      const value=(await this.input.outbox.list()).find(v=>(this.retryAfter.get(v.receiptId)??0)<=now);
      if(!value)return 0;
      try {
        await this.deliver(value);settled++;this.retryAfter.delete(value.receiptId);
        if(![...quarantined,...await this.input.outbox.list()].some(v=>v.result.conversation_id===value.result.conversation_id))
          await this.input.onRecovered?.(value.result.conversation_id);
      } catch(error) {
        this.retryAfter.set(value.receiptId,now+30_000);
        await this.input.onRecoveryBlocked?.(value.result.conversation_id).catch(()=>{});
        const code=error&&typeof error==="object"&&"relayCode" in error?error.relayCode:null;
        if(code==="BACKGROUND_CONFLICT"||code==="BACKGROUND_NOT_FOUND")await this.input.outbox.quarantine(value);
      }
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
