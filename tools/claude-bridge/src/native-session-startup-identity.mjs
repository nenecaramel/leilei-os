// Shared original-session verification for one-turn and persistent SDK hosts.
const nonblankString = value => typeof value === "string" && value.trim() ? value : null;
const runtimeError = (message, details = {}) => Object.assign(new Error(message), details);

export function observeNativeSessionStartup(state, message) {
  const sessionId = nonblankString(message?.session_id) ?? nonblankString(message?.sessionId);
  if (sessionId && sessionId !== state.parentProviderSessionId) {
    throw runtimeError("Native resume started a different provider session before prompt delivery.", {
      runtimeCode: "PROVIDER_SESSION_CONFLICT",
    });
  }
  if (state.startupReceipt && message?.type === "system" &&
      message?.subtype === "hook_response" && message?.hook_event === "SessionStart" &&
      message?.stdout?.trim() === state.startupReceipt && message?.outcome === "success" &&
      message?.exit_code === 0) {
    if (!sessionId) throw runtimeError("Native resume startup receipt has no session identity.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
    state.nativeStartupReceiptConfirmed = true;
    state.settleNativeIdentity(true);
  }
  // CLI acknowledges the queued command before emitting per-turn init.
  // These are transport receipts, never approval for assistant execution.
  const verifiedQueueReceipt = state.nativeStartupReceiptConfirmed &&
    sessionId === state.parentProviderSessionId &&
    message?.type === "command_lifecycle" &&
    message?.command_uuid === state.initialUserMessageUuid &&
    (message?.state === "queued" || message?.state === "started");
  if (message?.type === "system" && message?.subtype === "init") {
    if (!sessionId) throw runtimeError("Native resume init has no session identity.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
    state.nativeIdentityConfirmed = true;
    state.settleNativeIdentity(true);
  } else if (!state.nativeIdentityConfirmed && message?.type !== "system" && !verifiedQueueReceipt) {
    throw runtimeError("Native resume has no verified init before execution.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
  }

  return message?.type === "system" && message?.subtype === "init";
}
