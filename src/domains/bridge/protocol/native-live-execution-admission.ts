// Identity-only snapshot check. No prompt, model input, receipt or credential.
export type NativeLiveExecutionAdmission = {
  listenerInstanceId: string;
  reservationId: string;
  requestId: string;
  conversationId: string;
  runtimeMode: "new" | "resume" | "fork";
  canonicalUserMessageId: string | null;
  parentProviderSessionId: string | null;
  parentProviderCheckpointId: string | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const keys = ["listener_instance_id", "request_id", "conversation_id", "runtime_mode", "canonical_user_message_id", "parent_provider_session_id", "parent_provider_checkpoint_id"];
const nullableId = (v: unknown): v is string | null => v === null || (typeof v === "string" && v.length <= 512 && v.trim().length > 0);
export function parseNativeLiveExecutionAdmissionBody(value: unknown): Omit<NativeLiveExecutionAdmission, "reservationId"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))) return null;
  for (const key of ["listener_instance_id", "request_id", "conversation_id"]) if (typeof body[key] !== "string" || !uuid.test(body[key])) return null;
  if (body.canonical_user_message_id !== null && (typeof body.canonical_user_message_id !== "string" || !uuid.test(body.canonical_user_message_id))) return null;
  if (!nullableId(body.parent_provider_session_id) || !nullableId(body.parent_provider_checkpoint_id)) return null;
  if (body.runtime_mode !== "new" && body.runtime_mode !== "resume" && body.runtime_mode !== "fork") return null;
  if (body.runtime_mode === "new" && (body.parent_provider_session_id !== null || body.parent_provider_checkpoint_id !== null)) return null;
  if (body.runtime_mode !== "new" && (body.parent_provider_session_id === null || body.parent_provider_checkpoint_id === null)) return null;
  return { listenerInstanceId: body.listener_instance_id as string, requestId: body.request_id as string, conversationId: body.conversation_id as string,
    runtimeMode: body.runtime_mode, canonicalUserMessageId: body.canonical_user_message_id as string | null,
    parentProviderSessionId: body.parent_provider_session_id, parentProviderCheckpointId: body.parent_provider_checkpoint_id };
}

/** Bind only the exact input UUID that the native CLI accepted. The phase is
 * supplied over the authenticated daemon channel, never inferred from text. */
export type NativeLiveInputBindingBody = Omit<NativeLiveExecutionAdmission, "reservationId"> & {
  phase: "queued" | "started"; commandUuid: string;
};
export function parseNativeLiveInputBindingBody(value: unknown): NativeLiveInputBindingBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== keys.length + 2 || !Object.hasOwn(body, "phase")
      || !Object.hasOwn(body, "command_uuid")) return null;
  const { phase, command_uuid, ...admission } = body;
  if (phase !== "queued" && phase !== "started") return null;
  const parsed = parseNativeLiveExecutionAdmissionBody(admission);
  if (!parsed || parsed.runtimeMode !== "resume" || !parsed.canonicalUserMessageId
      || typeof command_uuid !== "string" || !uuid.test(command_uuid)
      || command_uuid !== parsed.canonicalUserMessageId) return null;
  return { ...parsed, phase, commandUuid: command_uuid };
}
