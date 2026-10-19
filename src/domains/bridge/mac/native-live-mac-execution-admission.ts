import type { NativeLiveMacPersistentSessionOptions } from "./native-live-mac-claude-transport.js";
import type { NativeLiveMacDaemonRelayClient } from "./native-live-mac-daemon-loop.js";
import type { NativeLiveRuntimeCommand } from "../protocol/native-live-runtime-protocol.js";

// One reservation's callback, not a lifetime authorization for an SDK session.
// A future turn adapter must select the current reservation on every callback.
export function createNativeLiveMacExecutionAdmission(input: {
  listenerInstanceId: string;
  command: NativeLiveRuntimeCommand;
  relay: Pick<NativeLiveMacDaemonRelayClient, "checkExecutionAdmission">;
}): NativeLiveMacPersistentSessionOptions["authorize"] {
  const command = Object.freeze({ ...input.command });
  const listenerInstanceId = input.listenerInstanceId;
  const check = input.relay.checkExecutionAdmission?.bind(input.relay);
  // Fork/new callbacks belong to the newly claimed child, never the parent.
  let providerSessionId = command.runtime_mode === "resume" ? command.parent_provider_session_id : null;
  return async context => {
    if (!check || !(["send", "wake"].includes(command.operation) && ["new", "resume"].includes(command.runtime_mode)
        || ["edit", "retry"].includes(command.operation) && ["new", "fork"].includes(command.runtime_mode))
      || command.parent_provider_checkpoint_id === undefined
      || command.runtime_mode === "fork" && (!command.parent_provider_session_id || !command.parent_provider_checkpoint_id)) return false;
    if (context.inputId !== (command.canonical_user_message_id ?? command.prepare_id)) return false;
    if (context.phase === "input" && context.source !== (command.operation === "wake" ? "task-notification" : "human")) return false;
    if (command.runtime_mode === "resume" && context.providerSessionId !== providerSessionId) return false;
    if (context.phase === "tool" && !context.providerSessionId) return false;
    if (context.providerSessionId) {
      if (providerSessionId && context.providerSessionId !== providerSessionId) return false;
      providerSessionId = context.providerSessionId;
    }
    try { return await check({ listenerInstanceId, command }) === true; }
    catch { return false; } // No cached approval on timeout, malformed data or old server.
  };
}
