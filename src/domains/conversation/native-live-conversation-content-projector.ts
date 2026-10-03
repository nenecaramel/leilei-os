import { parseConversationProjection, type ConversationProjection } from "./native-live-content-contract.js";
import type { NativeLiveNormalizedEvent } from "./native-live-conversation-orchestrator.js";

export type ProjectionAttachment = {
  userId: string; attachmentId: string; status: string; filename: string;
  mimeType: string; kind: string; sizeBytes: number; sha256: string;
};
type AuthorizedProjection = { projection: ConversationProjection; attachments: Record<string,unknown>[] };
// Tokens live only in backend memory. Serialized runtime/provider fields cannot grant authority.
const decisions = new WeakMap<object, Map<NativeLiveNormalizedEvent, AuthorizedProjection>>();
export type TrustedConversationProjections = object & { readonly __backendProjection: unique symbol };

/** Explicit backend share decisions only; no SDK event/name/content heuristic calls this. */
export async function authorizeNativeLiveConversationProjections(input: {
  userId: string;
  decisions: readonly { event: NativeLiveNormalizedEvent; projection: unknown }[];
  resolveAttachment: (userId: string, attachmentId: string) => Promise<ProjectionAttachment | null>;
}): Promise<TrustedConversationProjections> {
  const authorized = new Map<NativeLiveNormalizedEvent,AuthorizedProjection>();
  for (const decision of input.decisions) {
    const projection = parseConversationProjection(decision.projection);
    if (!projection || projection.identity !== "canonical_tool_result") throw new TypeError("Unsupported backend structured projection decision.");
    if (!["tool_result","result"].includes(decision.event.type)) throw new TypeError("Unsupported projection event.");
    if (authorized.has(decision.event)) throw new TypeError("Duplicate projection decision.");
    const attachments: Record<string,unknown>[] = [];
    for (const ref of projection.refs) {
      // Artifact/Resource authority is reserved for F; D does not validate those entities.
      if (ref.type !== "attachment_ref") throw new TypeError("Unsupported projection entity authority.");
      const attachment = await input.resolveAttachment(input.userId,ref.entity_id);
      if (!attachment || attachment.userId !== input.userId || attachment.attachmentId !== ref.entity_id || !["ready","bound"].includes(attachment.status)) throw new TypeError("Projection attachment is not owned and ready.");
      attachments.push({ attachment_id:attachment.attachmentId, filename:attachment.filename,
        mime_type:attachment.mimeType,kind:attachment.kind,size_bytes:attachment.sizeBytes,
        sha256:attachment.sha256,storage:"native_live_attachment",materialization:"ready" });
    }
    authorized.set(decision.event,{projection,attachments});
  }
  const token = Object.freeze({}) as TrustedConversationProjections;
  decisions.set(token,authorized);
  return token;
}
export function backendConversationProjection(token: TrustedConversationProjections | undefined,event:NativeLiveNormalizedEvent): AuthorizedProjection | undefined {
  return token && decisions.get(token)?.get(event);
}
