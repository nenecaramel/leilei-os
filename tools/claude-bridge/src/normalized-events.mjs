import { randomUUID } from "node:crypto";

export function normalizeClaudeEvents(rawEvents, { logicalConversationId, mode, parentProviderSessionId = null }) {
  const output = []; let sessionId = null; let sequence = 0; let accumulated = "";
  const emit = (type, providerSessionId, payload, raw) => output.push({ event_id: randomUUID(), type, sequence: ++sequence, logical_conversation_id: logicalConversationId, provider_session_id: providerSessionId ?? sessionId, timestamp: new Date().toISOString(), payload, raw_metadata: { raw_event_type: raw.type ?? null, raw_event_subtype: raw.subtype ?? null } });
  for (const raw of rawEvents) {
    if (raw.session_id && sessionId && raw.session_id !== sessionId) { emit("error", sessionId, { code: "CONFLICTING_SESSION_ID", message: "Claude stream contained conflicting session ids.", stderr: null, exit_code: null }, raw); continue; }
    if (raw.session_id) sessionId = raw.session_id;
    if (raw.type === "system" && raw.subtype === "init") { emit("session", sessionId, { provider_session_id: sessionId, parent_provider_session_id: parentProviderSessionId, mode }, raw); continue; }
    if (raw.type === "assistant") {
      if (raw.delta?.text) { accumulated += raw.delta.text; emit("partial_text", sessionId, { delta: raw.delta.text, accumulated_length: accumulated.length }, raw); }
      for (const block of raw.message?.content ?? []) {
        if (block.type === "text") emit("text", sessionId, { role: "assistant", text: block.text, final: false }, raw);
        if (block.type === "tool_use") emit("tool_use", sessionId, { tool_use_id: block.id, tool_name: block.name, input: block.input }, raw);
        if (block.type === "tool_result") emit("tool_result", sessionId, { tool_use_id: block.tool_use_id, output: block.content, is_error: Boolean(block.is_error) }, raw);
      }
      continue;
    }
    if (raw.type === "result") { emit("result", sessionId, { status: raw.is_error ? "error" : "success", final_text: raw.result ?? null, exit_code: raw.exit_code ?? 0, duration_ms: raw.duration_ms ?? null }, raw); continue; }
    emit("runtime", sessionId, { raw_event_type: raw.type ?? null, raw_event_subtype: raw.subtype ?? null, metadata: raw.type === "rate_limit_event" ? { rate_limit: true } : null }, raw);
  }
  return output;
}
