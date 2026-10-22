import { write } from "node:fs";
import type { NativeLiveMacPersistentSessionOptions } from "./native-live-mac-claude-transport.js";
import type { NativeLiveMacDaemonRelayClient } from "./native-live-mac-daemon-loop.js";
import { nativeInputId, type NativeLiveRuntimeCommand } from "../protocol/native-live-runtime-protocol.js";

type DenialReason = "UNSUPPORTED_COMMAND" | "INPUT_ID_MISMATCH" | "SOURCE_MISMATCH"
  | "SESSION_MISMATCH" | "SESSION_MISSING" | "ADMISSION_NOT_GRANTED" | "RELAY_TIMEOUT"
  | "RELAY_ABORTED" | "RELAY_CONNECTION_RESET" | "RELAY_RESPONSE_BODY_UNAVAILABLE"
  | "RELAY_RESPONSE_INVALID_JSON" | "RELAY_HTTP_ERROR" | "RELAY_UNAVAILABLE";
export type NativeLiveMacAdmissionDenial = {
  prepareId: string | null; phase: string; reasonCode: DenialReason; elapsedMs: number;
};
function reportDenial(event: NativeLiveMacAdmissionDenial): void {
  // Use an fd callback so closed stderr cannot emit an unhandled stream error.
  write(2, JSON.stringify({ at: new Date().toISOString(), outcome: "execution_admission_denied", ...event }) + "\n", () => {});
}
function transportDenial(error: unknown): DenialReason {
  const e = error && typeof error === "object" ? error as Record<string, unknown> : {};
  if (e.name === "TimeoutError") return "RELAY_TIMEOUT";
  if (e.name === "AbortError") return "RELAY_ABORTED";
  if (e.relayCode === "RELAY_RESPONSE_BODY_UNAVAILABLE") return "RELAY_RESPONSE_BODY_UNAVAILABLE";
  if (e.relayCode === "RELAY_RESPONSE_INVALID_JSON") return "RELAY_RESPONSE_INVALID_JSON";
  const cause = e.cause && typeof e.cause === "object" ? e.cause as Record<string, unknown> : {};
  if (cause.code === "ECONNRESET" || e.code === "ECONNRESET") return "RELAY_CONNECTION_RESET";
  if (typeof e.httpStatus === "number" && e.httpStatus >= 400 && e.httpStatus <= 599) return "RELAY_HTTP_ERROR";
  return "RELAY_UNAVAILABLE";
}

// One reservation's callback, not a lifetime authorization for an SDK session.
// A future turn adapter must select the current reservation on every callback.
export function createNativeLiveMacExecutionAdmission(input: {
  listenerInstanceId: string;
  command: NativeLiveRuntimeCommand;
  relay: Pick<NativeLiveMacDaemonRelayClient, "checkExecutionAdmission">;
  onDenied?: (event: NativeLiveMacAdmissionDenial) => void;
}): NativeLiveMacPersistentSessionOptions["authorize"] {
  const command = Object.freeze({ ...input.command });
  const listenerInstanceId = input.listenerInstanceId;
  const check = input.relay.checkExecutionAdmission?.bind(input.relay);
  // Fork/new callbacks belong to the newly claimed child, never the parent.
  let providerSessionId = command.runtime_mode === "resume" ? command.parent_provider_session_id : null;
  return async context => {
    const started = performance.now();
    const deny = (reasonCode: DenialReason): false => {
      // Diagnostics never carry exception text, prompt, token or session bodies,
      // and failure to write a log must not change the authorization decision.
      try { (input.onDenied ?? reportDenial)({
        prepareId: /^[0-9a-f-]{36}$/i.test(command.prepare_id) ? command.prepare_id : null,
        phase: ["input", "tool", "scheduled"].includes(context.phase) ? context.phase : "unknown",
        reasonCode, elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      }); } catch { /* Fail closed even if the diagnostic sink is unavailable. */ }
      return false;
    };
    if (!check || !(["send", "wake"].includes(command.operation) && ["new", "resume"].includes(command.runtime_mode)
        || ["edit", "retry"].includes(command.operation) && ["new", "fork"].includes(command.runtime_mode)
        // Edit and Retry rewind their own session in place, as Desktop does.
        || ["edit", "retry"].includes(command.operation) && command.runtime_mode === "resume" && !!command.parent_provider_session_id)
      || command.parent_provider_checkpoint_id === undefined
      || command.runtime_mode === "fork" && (!command.parent_provider_session_id || !command.parent_provider_checkpoint_id)) return deny("UNSUPPORTED_COMMAND");
    if (context.inputId !== nativeInputId(command)) return deny("INPUT_ID_MISMATCH");
    if (context.phase === "input" && context.source !== (command.operation === "wake" ? "task-notification" : "human")) return deny("SOURCE_MISMATCH");
    if (command.runtime_mode === "resume" && context.providerSessionId !== providerSessionId) return deny("SESSION_MISMATCH");
    if (context.phase === "tool" && !context.providerSessionId) return deny("SESSION_MISSING");
    if (context.providerSessionId) {
      if (providerSessionId && context.providerSessionId !== providerSessionId) return deny("SESSION_MISMATCH");
      providerSessionId = context.providerSessionId;
    }
    try { return await check({ listenerInstanceId, command }) === true || deny("ADMISSION_NOT_GRANTED"); }
    catch (error) { return deny(transportDenial(error)); } // No cached approval on transport failure.
  };
}
