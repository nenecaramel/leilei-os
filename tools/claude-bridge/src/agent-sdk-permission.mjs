function runtimeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

function nonblankString(value) {
  return typeof value === "string" && value.trim()
    ? value
    : null;
}

function normalizeOptionalArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeAgentSdkPermissionRequest(
  toolName,
  input,
  context = {},
) {
  const normalizedToolName = nonblankString(toolName);
  if (!normalizedToolName) {
    throw runtimeError(
      "Agent SDK permission request is missing toolName.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  return {
    toolName: normalizedToolName,
    input:
      input
      && typeof input === "object"
      && !Array.isArray(input)
        ? input
        : {},
    toolUseId:
      nonblankString(context.toolUseID)
      ?? nonblankString(context.toolUseId)
      ?? nonblankString(context.tool_use_id)
      ?? null,
    requestId:
      nonblankString(context.requestId)
      ?? nonblankString(context.requestID)
      ?? nonblankString(context.request_id)
      ?? null,
    agentId:
      nonblankString(context.agentID)
      ?? nonblankString(context.agentId)
      ?? nonblankString(context.agent_id)
      ?? null,
    blockedPath:
      nonblankString(context.blockedPath) ?? null,
    decisionReason:
      nonblankString(context.decisionReason) ?? null,
    title:
      nonblankString(context.title) ?? null,
    displayName:
      nonblankString(context.displayName) ?? null,
    description:
      nonblankString(context.description) ?? null,
    permissionSuggestions:
      normalizeOptionalArray(
        context.permissionSuggestions,
      ),
    matchedAskRule:
      context.matchedAskRule
      && typeof context.matchedAskRule === "object"
        ? context.matchedAskRule
        : null,
  };
}

export function normalizeLeileiPermissionDecision(
  decision,
) {
  if (!decision || typeof decision !== "object") {
    throw runtimeError(
      "LeileiOS permission handler must return a decision object.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  if (decision.decision === "allow") {
    const normalized = {
      decision: "allow",
    };
    if ("updatedInput" in decision) {
      if (
        !decision.updatedInput
        || typeof decision.updatedInput !== "object"
        || Array.isArray(decision.updatedInput)
      ) {
        throw runtimeError(
          "Permission allow updatedInput must be an object when provided.",
          { runtimeCode: "RUNTIME_UNAVAILABLE" },
        );
      }
      normalized.updatedInput =
        decision.updatedInput;
    }
    return normalized;
  }

  if (decision.decision === "deny") {
    const message = nonblankString(decision.message);
    if (!message) {
      throw runtimeError(
        "Permission deny decision requires a nonblank message.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    if (
      "interrupt" in decision
      && typeof decision.interrupt !== "boolean"
    ) {
      throw runtimeError(
        "Permission deny interrupt must be boolean when provided.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    return {
      decision: "deny",
      message,
      interrupt: decision.interrupt === true,
    };
  }

  throw runtimeError(
    "Permission decision must be allow or deny.",
    { runtimeCode: "RUNTIME_UNAVAILABLE" },
  );
}

export function projectLeileiPermissionDecisionToSdk(
  decision,
) {
  const normalized =
    normalizeLeileiPermissionDecision(decision);

  if (normalized.decision === "allow") {
    return {
      behavior: "allow",
      ...(
        normalized.updatedInput
          ? {
              updatedInput:
                normalized.updatedInput,
            }
          : {}
      ),
    };
  }

  return {
    behavior: "deny",
    message: normalized.message,
    interrupt: normalized.interrupt,
  };
}

const TRUSTED_LOCAL_ALBUM_TOOLS = new Set([
  "mcp__leileios_album__save_photo",
  "mcp__leileios_album__search_photos",
  "mcp__leileios_album__view_photo",
  "mcp__leileios_album__send_photo",
]);

export function trustedNativeLiveToolPolicy(toolName) {
  if (
    typeof toolName === "string"
    && toolName.startsWith("mcp__leileios__")
  ) {
    return "leileios_all";
  }

  if (TRUSTED_LOCAL_ALBUM_TOOLS.has(toolName)) {
    return "leileios_album";
  }

  if (toolName === "mcp__leileios_local__send_file") {
    return "leileios_local_send_file";
  }

  return null;
}

export function isTrustedLeileiosTool(toolName) {
  return trustedNativeLiveToolPolicy(toolName) !== null;
}

export function createAgentSdkPermissionCallback({
  permissionHandler,
  events = null,
} = {}) {
  if (typeof permissionHandler !== "function") {
    throw runtimeError(
      "permissionHandler must be a function.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  return async (
    toolName,
    input,
    context = {},
  ) => {
    const request =
      normalizeAgentSdkPermissionRequest(
        toolName,
        input,
        context,
      );

    const trustedPolicy =
      trustedNativeLiveToolPolicy(toolName);
    if (trustedPolicy) {
      const decision = { decision: "allow" };
      events?.emit?.("permission-decision", {
        request,
        decision,
        trustedPolicy,
      });
      return { behavior: "allow" };
    }

    events?.emit?.(
      "permission-request",
      request,
    );

    let rawDecision;
    try {
      rawDecision = await permissionHandler(
        request,
        {
          signal:
            context.signal ?? null,
        },
      );
    } catch (cause) {
      events?.emit?.(
        "permission-error",
        {
          request,
          cause,
        },
      );
      throw cause;
    }

    const decision =
      normalizeLeileiPermissionDecision(
        rawDecision,
      );
    const sdkDecision =
      projectLeileiPermissionDecisionToSdk(
        decision,
      );

    events?.emit?.(
      "permission-decision",
      {
        request,
        decision,
      },
    );

    return sdkDecision;
  };
}

export function assertInteractiveCallbackQueryOptions(
  queryOptions = {},
  callbackName = "host callback",
) {
  if (
    queryOptions
    && typeof queryOptions.canUseTool === "function"
  ) {
    throw runtimeError(
      `${callbackName} cannot be combined with queryOptions.canUseTool.`,
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  if (
    Array.isArray(queryOptions?.allowedTools)
    && queryOptions.allowedTools.length > 0
  ) {
    throw runtimeError(
      `${callbackName} cannot be combined with allowedTools because pre-allowed tools can bypass the callback.`,
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  if (
    queryOptions?.permissionMode
      === "bypassPermissions"
    || queryOptions
      ?.allowDangerouslySkipPermissions
      === true
  ) {
    throw runtimeError(
      `${callbackName} cannot be combined with permission bypass options.`,
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
}

export function assertPermissionCallbackQueryOptions(
  queryOptions = {},
) {
  return assertInteractiveCallbackQueryOptions(
    queryOptions,
    "permissionHandler",
  );
}
