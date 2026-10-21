import { isNativeSessionMirror } from "./native-session-mirror.mjs";
import { checkpointForkSessionStore } from "./provider-checkpoint-prefix.mjs";
import { createAgentSdkTurnHandle } from "./agent-sdk-turn-handle.mjs";
import { normalizeAgentSdkExecutionSelection } from "./agent-sdk-execution-selection.mjs";
import { normalizeAgentSdkContextUsage } from "./agent-sdk-context-observability.mjs";
import { normalizeAgentSdkExecutionReadback } from "./agent-sdk-execution-readback.mjs";
import {
  runtimeError,
  nonblankString,
  isNativeClaudeScheduleCommand,
  clippedSessionStoreReason,
  sdkMirrorFailureReason,
  sessionIdFromEvents,
  sessionStoreHealthSnapshot,
  attachSessionStoreHealth,
  leileiosMcpQueryOptions,
  LEILEIOS_INTERACTIVE_SYSTEM_PROMPT_OPTION,
} from "./agent-sdk-transport-support.mjs";

// State stays on the transport owner; private checkpoint operations are bound by its entry point.
export async function executeAgentSdkTurn(owner, checkpoints,
    prompt,
    {
      mode = "new",
      parentProviderSessionId = null,
      parentProviderCheckpointId = null,
      requireProviderCheckpoint = false,
      streaming = true,
      userMessageUuid = null,
      failedUserMessageUuids = [],
      execution = null,
      onNormalizedEvent = null,
      permissionHandler = null,
      questionHandler = null,
      trustedReadPaths = [],
      sendFileHandler = null,
      toolImageHandler = null,
      controlPump = null,
      nativeSessionMirror = null,
    } = {},
  ) {
    if (owner.activeQuery || owner.activeTurnHandle || owner.activeSessionHost) {
      throw runtimeError(
        "Claude Agent SDK transport already has an active turn.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    if (
      mode !== "new"
      && mode !== "resume"
      && mode !== "fork"
    ) {
      throw new Error(
        "Agent SDK interactive turn mode must be new, resume, or fork.",
      );
    }
    if (
      mode === "new"
      && parentProviderSessionId !== null
    ) {
      throw new Error(
        "New Agent SDK interactive turn must not include a parent provider session.",
      );
    }
    if (
      mode !== "new"
      && !nonblankString(parentProviderSessionId)
    ) {
      throw new Error(
        "Resume/fork Agent SDK interactive turn requires a parent provider session.",
      );
    }
    if (nativeSessionMirror !== null && (mode !== "resume" || !requireProviderCheckpoint ||
      !nonblankString(parentProviderCheckpointId) || !owner.sessionStore ||
      !isNativeSessionMirror(nativeSessionMirror, parentProviderSessionId, owner.sessionStore))) {
      throw runtimeError("Native resume requires an exact durable checkpoint and its original-source mirror.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
    }
    let checkpointPreflight = null;
    if (parentProviderCheckpointId !== null) {
      checkpointPreflight = await checkpoints.requireCheckpoint(
        parentProviderSessionId,
        parentProviderCheckpointId,
        {
          needPrefix:
            mode === "fork" && !owner.sessionStore,
        },
      );
    }

    let portability = {
      canComplete: true,
      parentLocalAvailable: null,
      parentStatusBefore: null,
      backfillStatus: "not_needed",
      backfillFailureReason: null,
    };
    if (mode !== "new") {
      try {
        portability = await checkpoints.prepareSessionForTurn(
          parentProviderSessionId,
          mode,
          parentProviderCheckpointId,
          nativeSessionMirror === null,
          nativeSessionMirror === null,
        );
      } catch (cause) {
        throw attachSessionStoreHealth(
          cause,
          sessionStoreHealthSnapshot({
            configured: Boolean(owner.sessionStore),
            mode,
            cwd: owner.cwd,
            parentSessionId: parentProviderSessionId,
            portability,
            completion: {
              statusAfter: null,
              statusFailureReason:
                clippedSessionStoreReason(cause),
            },
          }),
        );
      }
    }

    owner.abortRequested = false;
    const queryImpl = await checkpoints.resolveQuery();
    if (owner.abortRequested) {
      throw runtimeError(
        "Claude Agent SDK turn was aborted before startup completed.",
        { runtimeCode: "ABORTED" },
      );
    }

    const executionOptions =
      normalizeAgentSdkExecutionSelection(execution);
    const nativeScheduleCommand =
      isNativeClaudeScheduleCommand(prompt);
    if (mode === "resume" && parentProviderCheckpointId !== null
      && !owner.sessionStore && !nativeScheduleCommand) {
      await checkpoints.validateLocalResumeTail(
        parentProviderSessionId, parentProviderCheckpointId, userMessageUuid, failedUserMessageUuids,
      );
    }
    const localSendFileServer =
      sendFileHandler
        ? await owner.createSendFileMcpServerImpl(
            sendFileHandler,
          )
        : null;

    let localCheckpointFork = null;
    if (
      mode === "fork"
      && !owner.sessionStore
      && parentProviderCheckpointId !== null
    ) {
      localCheckpointFork =
        await owner.prepareLocalCheckpointForkImpl({
          sessionId: parentProviderSessionId,
          checkpointId: parentProviderCheckpointId,
          prefix: checkpointPreflight?.prefix ?? null,
          cwd: owner.cwd,
          environment: owner.environment,
        });
    }
    const sdkParentProviderSessionId =
      localCheckpointFork?.sessionId
      ?? parentProviderSessionId;

    let handle;
    try {
      handle = await createAgentSdkTurnHandle({
      prompt,
      mode,
      parentProviderSessionId,
      resume:
        mode === "new"
          ? null
          : sdkParentProviderSessionId,
      forkSession: mode === "fork",
      resumeSessionAt: parentProviderCheckpointId,
      queryImpl,
      // The deployed daemon uses local SDK storage (no remote materializer).
      // Protect that actual path too, not only the optional native mirror.
      requireSameSessionBeforePrompt: nativeSessionMirror !== null || (
        mode === "resume"
        && parentProviderCheckpointId !== null
        && !owner.sessionStore
        && !nativeScheduleCommand
      ),
      environment: owner.environment,
      cwd: owner.cwd,
      queryOptions: {
        ...(owner.toolPermissionPolicy === "auto_allow" ? { permissionMode: "default" } : {}),
        ...(owner.artifactEnabled ? { settings: { enableArtifact: true } } : {}),
        ...(owner.chromeEnabled ? { extraArgs: { chrome: null } } : {}),
        verbatimPrompts: !nativeScheduleCommand,
        systemPrompt: LEILEIOS_INTERACTIVE_SYSTEM_PROMPT_OPTION,
        ...executionOptions,
        // Newer Claude models default to omitted thinking (empty text + signature).
        // Request the provider's displayable summary only for interactive turns;
        // respect explicit disabled and between_tools modes.
        ...(!nativeScheduleCommand
          && (executionOptions.thinking === undefined
            || executionOptions.thinking.type === "adaptive")
          ? { thinking: { type: "adaptive", display: "summarized" } }
          : {}),
        ...leileiosMcpQueryOptions(
          owner.mcpServerConfig,
          localSendFileServer,
        ),
        ...(owner.sessionStore
          ? { sessionStore: nativeSessionMirror ?? (mode === "fork" || portability.checkpointRecovered
            ? checkpointForkSessionStore(owner.sessionStore, parentProviderSessionId, parentProviderCheckpointId, portability.checkpointRecovered)
            : owner.sessionStore) }
          : {}),
      },
      streaming,
      userMessageUuid,
      permissionHandler,
      toolPermissionPolicy: owner.toolPermissionPolicy,
      questionHandler,
      toolImageHandler,
      trustedReadPaths,
      midTurnInput:
        Boolean(controlPump) && !nativeScheduleCommand,
      executionReadback: Boolean(execution),
      });
    } catch (cause) {
      if (localCheckpointFork) {
        await localCheckpointFork.cleanup().catch(() => undefined);
      }
      throw cause;
    }

    owner.activeTurnHandle = handle;
    const forwardRaw = (event) => {
      owner.events.emit("event", event);
    };
    let eventDelivery = Promise.resolve();
    let eventDeliveryError = null;
    const forwardNormalized = (event) => {
      owner.events.emit("normalized-event", event);
      if (onNormalizedEvent) {
        eventDelivery = eventDelivery
          .then(() => onNormalizedEvent(event))
          .catch((cause) => {
            eventDeliveryError ??= cause;
          });
      }
    };
    handle.events.on("event", forwardRaw);
    handle.events.on(
      "normalized-event",
      forwardNormalized,
    );

    const controlAbort = new AbortController();
    let controlPumpError = null;
    let controlPumpPromise = Promise.resolve();

    try {
      const completion = handle.start();
      if (controlPump) {
        controlPumpPromise = Promise.resolve(
          controlPump(
            {
              sendUserMessage: (text, options = {}) =>
                handle.sendUserMessage(text, options),
              interrupt: () => handle.interrupt(),
            },
            { signal: controlAbort.signal },
          ),
        ).catch((cause) => {
          controlPumpError ??= cause;
        });
      }

      let handleResult;
      try {
        handleResult = await completion;
      } catch (cause) {
        if (!owner.sessionStore && parentProviderSessionId) {
          owner.localCheckpointAncestry.delete(
            parentProviderSessionId,
          );
        }
        const events =
          Array.isArray(cause?.events) ? cause.events : [];
        const providerSessionId =
          nonblankString(cause?.providerSessionId)
          ?? sessionIdFromEvents(events);
        const mirrorFailureReason =
          sdkMirrorFailureReason(events);
        const completionState =
          await checkpoints.completePortability(
            providerSessionId,
            false,
            mirrorFailureReason,
            mode === "resume" && portability.canComplete,
          );
        throw attachSessionStoreHealth(
          cause,
          sessionStoreHealthSnapshot({
            configured: Boolean(owner.sessionStore),
            mode,
            cwd: owner.cwd,
            sessionId: providerSessionId,
            parentSessionId: parentProviderSessionId,
            portability,
            completion: completionState,
            mirrorFailureReason,
          }),
        );
      }
      const contextUsage =
        normalizeAgentSdkContextUsage(handleResult.rawContextUsage);
      const executionReadback =
        execution
          ? normalizeAgentSdkExecutionReadback({
              requested: execution,
              settings: handleResult.rawExecutionSettings,
              supportedModels: handleResult.rawSupportedModels,
            })
          : null;
      const {
        rawContextUsage: _rawContextUsage,
        contextUsageError,
        rawExecutionSettings: _rawExecutionSettings,
        rawSupportedModels: _rawSupportedModels,
        executionReadbackError,
        ...result
      } = handleResult;

      if (!result.providerSessionId) {
        throw runtimeError(
          "Claude Agent SDK interactive turn returned no provider session id.",
          {
            runtimeCode: "NO_PROVIDER_SESSION",
            ...result,
          },
        );
      }
      if (
        mode === "fork"
        && (
          result.providerSessionId === parentProviderSessionId
          || result.providerSessionId === sdkParentProviderSessionId
        )
      ) {
        throw runtimeError(
          "Claude Agent SDK fork returned the same provider session id as its parent.",
          {
            runtimeCode: "PROVIDER_SESSION_CONFLICT",
            parentSessionId: parentProviderSessionId,
            forkSessionId: result.providerSessionId,
            ...result,
          },
        );
      }
      if (mode === "resume" && result.providerSessionId !== parentProviderSessionId) {
        throw runtimeError("Claude Agent SDK resume changed provider session identity.", {
          runtimeCode: "PROVIDER_SESSION_CONFLICT", ...result,
        });
      }
      if ((requireProviderCheckpoint || portability.checkpointRecovered) && sdkMirrorFailureReason(result.events)) {
        throw runtimeError("Claude checkpoint cannot be committed after a failed transcript mirror.", {
          runtimeCode: "RUNTIME_UNAVAILABLE", ...result,
        });
      }
      const providerCheckpointId = await checkpoints.completedCheckpoint(
        result.providerSessionId, requireProviderCheckpoint || portability.checkpointRecovered, parentProviderCheckpointId,
      );
      await checkpoints.validateRecoveredCheckpoint(result.providerSessionId, providerCheckpointId, parentProviderCheckpointId, portability);
      const mirrorFailureReason =
        sdkMirrorFailureReason(result.events);
      const completionState =
        await checkpoints.completePortability(
          result.providerSessionId,
          portability.canComplete,
          mirrorFailureReason,
          mode === "resume" && portability.canComplete,
        );
      if (requireProviderCheckpoint && owner.sessionStore && completionState.statusAfter !== "complete"
        && !(mode === "resume" && portability.checkpointRecovered && completionState.statusAfter === "incomplete")) {
        throw runtimeError("Claude provider checkpoint did not become durable and complete.", {
          runtimeCode: "RUNTIME_UNAVAILABLE", ...result,
        });
      }
      const sessionStoreObservability =
        sessionStoreHealthSnapshot({
          configured: Boolean(owner.sessionStore),
          mode,
          cwd: owner.cwd,
          sessionId: result.providerSessionId,
          parentSessionId: parentProviderSessionId,
          portability,
          completion: completionState,
          mirrorFailureReason,
        });
      owner.events.emit("exit", {
        code: 0,
        signal: null,
      });
      return {
        ...result,
        providerCheckpointId,
        contextUsage,
        contextUsageError,
        executionReadback,
        executionReadbackError,
        sessionStoreObservability,
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
      };
    } finally {
      controlAbort.abort();
      await controlPumpPromise;
      await eventDelivery;
      if (controlPumpError) {
        owner.events.emit(
          "control-pump-error",
          controlPumpError,
        );
      }
      if (eventDeliveryError) {
        owner.events.emit(
          "event-delivery-error",
          eventDeliveryError,
        );
      }
      handle.events.off("event", forwardRaw);
      handle.events.off(
        "normalized-event",
        forwardNormalized,
      );
      if (owner.activeTurnHandle === handle) {
        owner.activeTurnHandle = null;
      }
      if (localCheckpointFork) {
        try {
          await localCheckpointFork.cleanup();
        } catch (cause) {
          owner.events.emit(
            "local-checkpoint-fork-cleanup-error",
            cause,
          );
        }
      }
    }
  }
