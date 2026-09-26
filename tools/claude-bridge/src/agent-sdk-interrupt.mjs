function runtimeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

export function normalizeAgentSdkInterruptReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw runtimeError(
      "Claude Agent SDK interrupt() returned an invalid receipt.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  if (!Array.isArray(value.still_queued)) {
    throw runtimeError(
      "Claude Agent SDK interrupt receipt is missing still_queued.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  const stillQueued = value.still_queued.map((candidate) => {
    if (typeof candidate !== "string" || !candidate.trim()) {
      throw runtimeError(
        "Claude Agent SDK interrupt receipt contains an invalid queued message id.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    return candidate;
  });
  return { still_queued: stillQueued };
}
