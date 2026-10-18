import type { NativeLiveMacPersistentTurnOutput } from "./native-live-mac-claude-transport.js";
import type { NativeLiveMacOutputAttachmentDescriptor, NativeLiveMacOutputAttachmentSender } from "./native-live-mac-output-attachment-sender.js";

export type NativeLiveMacOutputAttachmentReceipt = {
  outputAttachmentIds: string[];
  outputAttachmentMetadata?: Array<{ attachment_id: string; duration_seconds: number }>;
};
export type NativeLiveMacOutputAttachmentCollector = Pick<NativeLiveMacPersistentTurnOutput, "sendFileHandler" | "toolImageHandler"> & {
  seal(): Promise<NativeLiveMacOutputAttachmentReceipt>;
  abort(): void;
};
export type NativeLiveMacOutputAttachmentSenderLike = Pick<NativeLiveMacOutputAttachmentSender, "sendFile"> & Partial<Pick<NativeLiveMacOutputAttachmentSender, "sendInlineImage">>;

/** One immutable output receipt per foreground turn or exact autonomous segment.
 * File/image validation and uploads remain owned by the existing sender. */
export function createNativeLiveMacOutputAttachmentCollector(input: {
  sender: NativeLiveMacOutputAttachmentSenderLike | null;
  workingDirectory(): string;
  /** Autonomous collectors recheck durable task ownership around every upload. */
  authorize?(): Promise<void>;
}): NativeLiveMacOutputAttachmentCollector {
  const ids: string[] = [], metadata: NonNullable<NativeLiveMacOutputAttachmentReceipt["outputAttachmentMetadata"]> = [];
  const pending = new Set<Promise<unknown>>(), abort = new AbortController();
  let sealing: Promise<NativeLiveMacOutputAttachmentReceipt> | null = null;
  const send = (work: (signal: AbortSignal) => Promise<NativeLiveMacOutputAttachmentDescriptor>, signal?: AbortSignal) => {
    if (sealing) return Promise.reject(new Error("Output attachment segment is sealed."));
    abort.signal.throwIfAborted();
    signal?.throwIfAborted();
    if (ids.length + pending.size >= 8) return Promise.reject(new Error("Tool images and send_file may send at most 8 files in one turn."));
    const combined = signal ? AbortSignal.any([abort.signal, signal]) : abort.signal;
    const running = Promise.resolve().then(async () => {
      combined.throwIfAborted();
      await input.authorize?.();
      combined.throwIfAborted();
      const value = await work(combined);
      combined.throwIfAborted();
      await input.authorize?.();
      combined.throwIfAborted();
      ids.push(value.attachmentId);
      if (typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0)
        metadata.push({attachment_id:value.attachmentId,duration_seconds:value.durationSeconds});
      return value;
    });
    pending.add(running);
    void running.finally(() => pending.delete(running)).catch(() => {});
    return running;
  };
  return {
    ...(input.sender ? {sendFileHandler: file => send(() => input.sender!.sendFile({...file,workingDirectory:input.workingDirectory()}))} : {}),
    ...(input.sender?.sendInlineImage ? {toolImageHandler: (image, context) => send(signal => input.sender!.sendInlineImage!({...image,signal}),context.signal)} : {}),
    seal() {
      sealing ??= (async () => {
        await Promise.allSettled([...pending]);
        abort.signal.throwIfAborted();
        if (ids.length) await input.authorize?.();
        abort.signal.throwIfAborted();
        const receipt = {outputAttachmentIds:[...ids],...(metadata.length ? {outputAttachmentMetadata:metadata.map(value => ({...value}))} : {})};
        abort.abort();
        return receipt;
      })();
      return sealing;
    },
    abort() { abort.abort(); },
  };
}
