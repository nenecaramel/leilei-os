import { openAgentSdkPersistentSession } from "./agent-sdk-persistent-session.mjs";
import { executeAgentSdkTurn } from "./agent-sdk-foreground-execution.mjs";
import { durableCheckpointPrefix, checkpointForkSessionStore } from "./provider-checkpoint-prefix.mjs";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { listDesktopNativeSessions } from "./native-session-inspection.mjs";
import { ClaudeTransport } from "./claude-transport.mjs";
import { ClaudeEventNormalizer } from "./normalized-events.mjs";
import {
  createAgentSdkPermissionCallback,
  normalizeAgentSdkToolPermissionPolicy,
} from "./agent-sdk-permission.mjs";
import { normalizeAgentSdkExecutionSelection } from "./agent-sdk-execution-selection.mjs";
import { normalizeAgentSdkContextUsage } from "./agent-sdk-context-observability.mjs";
import { normalizeAgentSdkExecutionReadback } from "./agent-sdk-execution-readback.mjs";
import {
  runtimeError,
  loadDefaultListSessions,
  loadDefaultSessionMessages,
  loadDefaultImportSessionToStore,
  loadDefaultDeleteSession,
  loadDefaultQuery,
  createDefaultSendFileMcpServer,
  nonblankString,
  sdkInterruptedTailStart,
  sdkRefusalTailStart,
  sdkAuthenticationFailureTailStart,
  sdkFailedReplyTailStart,
  sdkResultFailed,
  sdkMirrorFailed,
  clippedSessionStoreReason,
  sdkMirrorFailureReason,
  sessionStoreHealthSnapshot,
  attachSessionStoreHealth,
  sdkFailureMessage,
  normalizeLeileiosMcpServerConfig,
  leileiosMcpQueryOptions,
} from "./agent-sdk-transport-support.mjs";

export { durableCheckpointPrefix } from "./provider-checkpoint-prefix.mjs";

export class AgentSdkClaudeTransport extends ClaudeTransport {
  constructor({
    queryImpl = null,
    loadQuery = loadDefaultQuery,
    deleteSessionImpl = null,
    loadDeleteSession = loadDefaultDeleteSession,
    listSessionsImpl = null,
    loadListSessions = loadDefaultListSessions,
    sessionMessagesImpl = null,
    loadSessionMessages = loadDefaultSessionMessages,
    importSessionToStoreImpl = null,
    loadImportSessionToStore = loadDefaultImportSessionToStore,
    sessionStore = null,
    toolPermissionPolicy = "ask",
    mcpServerConfig = null,
    createSendFileMcpServerImpl =
      createDefaultSendFileMcpServer,
    environment = process.env,
    cwd = process.cwd(),
  } = {}) {
    super();
    if (environment.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY must be unset; native live uses Claude subscription auth.",
      );
    }
    const artifactSetting = environment.LEILEI_NATIVE_LIVE_CLAUDE_ARTIFACT?.trim() || "0";
    if (artifactSetting !== "0" && artifactSetting !== "1") {
      throw new Error("LEILEI_NATIVE_LIVE_CLAUDE_ARTIFACT must be 0 or 1.");
    }
    this.artifactEnabled = artifactSetting === "1";
    const chromeSetting = environment.LEILEI_NATIVE_LIVE_CLAUDE_CHROME?.trim() || "0";
    if (chromeSetting !== "0" && chromeSetting !== "1") {
      throw new Error("LEILEI_NATIVE_LIVE_CLAUDE_CHROME must be 0 or 1.");
    }
    this.chromeEnabled = chromeSetting === "1";
    this.queryImpl = queryImpl;
    this.loadQuery = loadQuery;
    this.deleteSessionImpl = deleteSessionImpl;
    this.loadDeleteSession = loadDeleteSession;
    this.listSessionsImpl = listSessionsImpl;
    this.loadListSessions = loadListSessions;
    this.sessionMessagesImpl = sessionMessagesImpl;
    this.loadSessionMessages = loadSessionMessages;
    this.importSessionToStoreImpl = importSessionToStoreImpl;
    this.loadImportSessionToStore = loadImportSessionToStore;
    this.sessionStore = sessionStore;
    this.toolPermissionPolicy = normalizeAgentSdkToolPermissionPolicy(toolPermissionPolicy);
    this.mcpServerConfig =
      normalizeLeileiosMcpServerConfig(mcpServerConfig);
    this.createSendFileMcpServerImpl =
      createSendFileMcpServerImpl;
    this.localCheckpointAncestry = new Map();
    this.environment = {
      ...environment,
      // Share installed Mind Hooks with Desktop; honor an explicit emergency disable.
      LEILEI_MIND_HOOK_DISABLED: environment.LEILEI_MIND_HOOK_DISABLED ?? "0",
      DISABLE_AUTO_COMPACT: "1",
      CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
      // Edit/Retry rewind only over LeileiOS's own records. The SDK keeps an
      // inherited entrypoint, so a daemon started from a Claude Code or Desktop
      // shell would otherwise write its turns as claude-desktop.
      CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
    };
    this.cwd = cwd;
    this.events = new EventEmitter();
    this.activeQuery = null;
    this.activeTurnHandle = null;
    this.activeSessionHost = null;
    this.legacyOperation = null;
    this.abortRequested = false;
  }

  // The daemon's persistent executor owns this session across logical turns.
  // Keep new-session creation separate from exact native restore below.
  async openPersistentSession(options = {}) {
    return this.#openPersistentSession(options);
  }

  async restorePersistentSession(restore, options = {}) {
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if (!restore || Object.keys(restore).some(key => !["sessionId", "checkpointId", "inputId", "source", "timeoutMs", "rewind"].includes(key))
      || (restore.rewind !== undefined && typeof restore.rewind !== "boolean")
      || !uuid.test(restore.sessionId ?? "") || !uuid.test(restore.checkpointId ?? "") || !uuid.test(restore.inputId ?? "")
      || !["human", "task-notification"].includes(restore.source)) throw new Error("Native restore requires exact session/checkpoint/input identity and source.");
    const timeoutMs = restore.timeoutMs ?? 8_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("Native restore startup timeout is invalid.");
    if (this.sessionStore) throw new Error("Persistent native restore requires the original local transcript without a materializing session store.");
    return this.#openPersistentSession(options, { ...restore, timeoutMs });
  }

  async #openPersistentSession(options = {}, restore = null) {
    return openAgentSdkPersistentSession(this, {
      requireSession: (...args) => this.#requireSession(...args),
      requireCheckpoint: (...args) => this.#requireCheckpoint(...args),
      validateLocalResumeTail: (...args) => this.#validateLocalResumeTail(...args),
      validateLocalRewindTail: (...args) => this.#validateLocalRewindTail(...args),
      resolveQuery: (...args) => this.#resolveQuery(...args),
      checkpointEntries: (...args) => this.#checkpointEntries(...args),
    }, options, restore);
  }

  // Call after openPersistentSession settles; failed startup may still own a
  // live query whose failed close must be explicitly retried.
  async closePersistentSession(reason) {
    await this.activeSessionHost?.close(reason);
  }

  sendNew(prompt, execution = null) {
    return this.#run(prompt, {
      mode: "new",
      execution,
    });
  }

  async resume(sessionId, prompt, execution = null) {
    return this.#run(prompt, {
      mode: "resume",
      parentProviderSessionId: sessionId,
      resume: sessionId,
      execution,
    });
  }

  async fork(sessionId, prompt, execution = null) {
    const result = await this.#run(prompt, {
      mode: "fork",
      parentProviderSessionId: sessionId,
      resume: sessionId,
      forkSession: true,
      execution,
    });
    if (!result.providerSessionId || result.providerSessionId === sessionId) {
      throw runtimeError(
        "Claude Agent SDK fork returned the same provider session id as its parent.",
        {
          runtimeCode: "PROVIDER_SESSION_CONFLICT",
          parentSessionId: sessionId,
          forkSessionId: result.providerSessionId,
          ...result,
        },
      );
    }
    return result;
  }

  async executeTurn(
    prompt, options = {},
  ) {
    return this.#withLegacyAdmission(() => this.#executeTurn(prompt, options));
  }

  async #withLegacyAdmission(operation) {
    if (this.legacyOperation || this.activeSessionHost || this.activeQuery || this.activeTurnHandle) {
      throw runtimeError("Claude Agent SDK transport already has an active turn.", { runtimeCode: "RUNTIME_UNAVAILABLE" });
    }
    const claim = {};
    this.legacyOperation = claim;
    try { return await operation(); }
    finally { if (this.legacyOperation === claim) this.legacyOperation = null; }
  }

  async #executeTurn(prompt, options = {}) {
    return executeAgentSdkTurn(this, {
      requireCheckpoint: (...args) => this.#requireCheckpoint(...args),
      prepareSessionForTurn: (...args) => this.#prepareSessionForTurn(...args),
      resolveQuery: (...args) => this.#resolveQuery(...args),
      validateLocalResumeTail: (...args) => this.#validateLocalResumeTail(...args),
      validateLocalRewindTail: (...args) => this.#validateLocalRewindTail(...args),
      completePortability: (...args) => this.#completePortability(...args),
      completedCheckpoint: (...args) => this.#completedCheckpoint(...args),
      validateRecoveredCheckpoint: (...args) => this.#validateRecoveredCheckpoint(...args),
    }, prompt, options);
  }

  async compact(sessionId, execution = null, parentProviderCheckpointId = null) {
    const lifecycle = {
      preCompact: [],
      postCompact: [],
    };
    const hooks = {
      PreCompact: [
        {
          hooks: [
            async (input) => {
              lifecycle.preCompact.push({
                hookEventName: input?.hook_event_name ?? null,
                trigger: input?.trigger ?? null,
                customInstructions:
                  typeof input?.custom_instructions === "string"
                    ? input.custom_instructions
                    : null,
              });
              return {};
            },
          ],
        },
      ],
      PostCompact: [
        {
          hooks: [
            async (input) => {
              lifecycle.postCompact.push({
                hookEventName: input?.hook_event_name ?? null,
                trigger: input?.trigger ?? null,
                summary:
                  typeof input?.compact_summary === "string"
                    ? input.compact_summary
                    : null,
              });
              return {};
            },
          ],
        },
      ],
    };

    const result = await this.#run("/compact", {
      parentProviderCheckpointId,
      requireProviderCheckpoint: parentProviderCheckpointId !== null,
      mode: "resume",
      parentProviderSessionId: sessionId,
      resume: sessionId,
      execution,
      verbatimPrompts: false,
      captureContextUsage: true,
      hooks,
    });

    if (result.providerSessionId !== sessionId) {
      throw runtimeError(
        "Claude Agent SDK compact changed provider session identity.",
        {
          runtimeCode: "PROVIDER_SESSION_CONFLICT",
          parentSessionId: sessionId,
          compactSessionId: result.providerSessionId,
          ...result,
        },
      );
    }

    const boundary =
      [...result.normalizedEvents]
        .reverse()
        .find((event) => event.type === "compaction")
        ?.payload ?? null;
    if (!boundary) {
      throw runtimeError(
        "Claude Agent SDK compact completed without a compact boundary.",
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          ...result,
        },
      );
    }

    return {
      ...result,
      compaction: {
        boundary,
        preCompact: lifecycle.preCompact,
        postCompact: lifecycle.postCompact,
      },
    };
  }

  async inspectDesktopSessions({
    desktopSessionsDirectory = join(homedir(), "Library", "Application Support", "Claude", "claude-code-sessions"),
  } = {}) {
    if (this.activeQuery || this.activeTurnHandle || this.activeSessionHost) {
      throw runtimeError("Native Desktop inspection is unavailable during an active LeileiOS turn.", { runtimeCode: "RUNTIME_UNAVAILABLE" });
    }
    const configDirectory = this.environment.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    return listDesktopNativeSessions({
      desktopSessionsDirectory,
      projectsDirectory: join(configDirectory, "projects"),
      peerDirectory: join(configDirectory, "sessions"),
    });
  }

  async listSessions({
    allDirectories = false,
    limit = 100,
    offset = 0,
  } = {}) {
    if (this.activeQuery || this.activeTurnHandle || this.activeSessionHost) {
      throw runtimeError(
        "Claude Agent SDK sessions cannot be listed during an active turn.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    const listSessions = await this.#resolveListSessions();
    let rows;
    try {
      rows = await listSessions({
        ...(allDirectories ? {} : { dir: this.cwd }),
        limit,
        offset,
        includeWorktrees: false,
      });
    } catch (cause) {
      throw runtimeError(
        `Failed to list Claude Agent SDK sessions: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
    if (!Array.isArray(rows)) {
      throw runtimeError(
        "Claude Agent SDK listSessions() returned an invalid result.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    return rows
      .map((row) => ({
        sessionId: nonblankString(row?.sessionId),
        summary: nonblankString(row?.summary),
        customTitle: nonblankString(row?.customTitle),
        firstPrompt: nonblankString(row?.firstPrompt),
        gitBranch: nonblankString(row?.gitBranch),
        cwd: nonblankString(row?.cwd) ?? (allDirectories ? null : this.cwd),
        lastModified:
          Number.isFinite(row?.lastModified)
            ? row.lastModified
            : null,
        createdAt:
          Number.isFinite(row?.createdAt)
            ? row.createdAt
            : null,
      }))
      .filter((row) => row.sessionId && row.cwd);
  }

  async deleteSession(sessionId) {
    if (this.activeQuery || this.activeTurnHandle || this.activeSessionHost) {
      throw runtimeError(
        "Claude Agent SDK session cannot be deleted during an active turn.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    const id = nonblankString(sessionId);
    if (!id) {
      throw runtimeError(
        "Claude Agent SDK session id is required for deletion.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }

    const deleteSessionImpl = await this.#resolveDeleteSession();
    try {
      await deleteSessionImpl(id, {
        dir: this.cwd,
        ...(this.sessionStore
          ? { sessionStore: this.sessionStore }
          : {}),
      });
      this.localCheckpointAncestry.delete(id);
    } catch (cause) {
      throw runtimeError(
        `Failed to delete Claude Agent SDK session: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  abort(reason) {
    this.abortRequested = true;
    void this.activeSessionHost?.close?.(reason ?? Object.assign(new Error("Session host was closed."), {sessionCloseReason:"TRANSPORT_ABORT"})).catch(() => {});
    this.activeTurnHandle?.abort?.();
    this.activeQuery?.close?.();
  }

  async #checkpointEntries(sessionId, required, bounds = null) {
    let size=0;
    const check=batch=>{
      if(!bounds)return;
      size+=Buffer.byteLength(JSON.stringify(batch));
      if(size>bounds.maxBytes||batch.length>bounds.maxEntries)throw new Error("Native recovery snapshot exceeds its bound.");
    };
    if (this.sessionStore && typeof this.sessionStore.load === "function") {
      const entries = await this.sessionStore.load({ projectKey: this.cwd, sessionId });
      if (Array.isArray(entries) && entries.length) { check(entries); return entries; }
      return [];
    } else if (!required) return [];
    const entries = [];
    const importer = this.importSessionToStoreImpl ?? await this.loadImportSessionToStore();
    try { await importer(sessionId, {
      append: async (key, batch) => { if (!key.subpath) { check(batch); if(bounds&&entries.length+batch.length>bounds.maxEntries)throw new Error("Native recovery snapshot exceeds its bound.");entries.push(...batch); } },
      load: async () => null,
    }, { dir: this.cwd, includeSubagents: false, batchSize: 500 });
    } catch (cause) {
      throw runtimeError("Claude provider transcript is unavailable for checkpoint addressing.", {
        runtimeCode: "NO_PROVIDER_SESSION", cause,
      });
    }
    return entries;
  }

  #chainEntries(entries) {
    return entries.filter(entry => entry && !entry.isSidechain
      && ["user", "assistant", "system", "attachment"].includes(entry.type)
      && typeof entry.uuid === "string" && Object.hasOwn(entry, "parentUuid"));
  }

  // Desktop-style rewind (Edit): resumeSessionAt an earlier checkpoint drops
  // everything after it from the resumed view. Only LeileiOS's own SDK records
  // (entrypoint sdk-ts) may be dropped; any other writer's record is unseen
  // native history and is never rewound. The JSONL itself is never edited.
  async #validateLocalRewindTail(sessionId, checkpointId) {
    const allEntries = await this.#checkpointEntries(sessionId, true);
    const tailId = this.#chainEntries(allEntries).at(-1)?.uuid;
    const conflict = () => runtimeError(
      "Native session has unsynchronized history; restore it before continuing.",
      { runtimeCode: "PROVIDER_SESSION_CONFLICT" },
    );
    if (!tailId) throw conflict();
    let verified;
    try { verified = durableCheckpointPrefix(allEntries, tailId); }
    catch { throw conflict(); }
    if (!verified.ancestry.has(checkpointId)) throw conflict();
    // The CLI starts history at the last compact boundary in file order, so a
    // checkpoint before it cannot be resumed; Desktop's rewind refuses it too.
    const boundary = allEntries.findLastIndex(entry => entry && !entry.isSidechain
      && entry.type === "system" && entry.subtype === "compact_boundary");
    if (boundary > allEntries.findLastIndex(entry => entry && !entry.isSidechain && entry.uuid === checkpointId)) {
      throw runtimeError("Edit cannot rewind past the latest native compaction.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
    }
    const byId = new Map(this.#chainEntries(verified.prefix).map(entry => [entry.uuid, entry]));
    for (let id = tailId; id !== checkpointId; id = byId.get(id).parentUuid) {
      if (byId.get(id).entrypoint !== "sdk-ts") throw conflict();
    }
  }

  async #validateLocalResumeTail(sessionId, checkpointId, userMessageUuid, failedUserMessageUuids) {
    // An ancestry cache proves presence, not that Desktop has stayed at that
    // checkpoint. Read again before query so an unseen native turn is not rewound.
    const allEntries = await this.#checkpointEntries(sessionId, true);
    const entries = this.#chainEntries(allEntries);
    const tailId = entries.at(-1)?.uuid;
    const conflict = () => runtimeError(
      "Native session has unsynchronized history; restore it before continuing.",
      { runtimeCode: "PROVIDER_SESSION_CONFLICT" },
    );
    if (!tailId) throw conflict();
    let verified;
    try { verified = durableCheckpointPrefix(allEntries, tailId); }
    catch { throw conflict(); }
    if (!verified.ancestry.has(checkpointId)) throw conflict();
    const byId = new Map(this.#chainEntries(verified.prefix).map(entry => [entry.uuid, entry]));
    const suffix = [];
    for (let id = tailId; id !== checkpointId; id = byId.get(id).parentUuid) suffix.push(byId.get(id));
    const failedInputs = new Set(failedUserMessageUuids);
    let sameCanonicalTurn = false;
    let failedInputOnly = false;
    const orderedSuffix = suffix.reverse();
    const approvedInputs = new Set([...failedInputs, ...(userMessageUuid ? [userMessageUuid] : [])]);
    const interruptedStart = sdkInterruptedTailStart(orderedSuffix, approvedInputs, sessionId)
      ?? sdkRefusalTailStart(orderedSuffix, approvedInputs, sessionId)
      ?? sdkAuthenticationFailureTailStart(orderedSuffix, failedInputs, sessionId)
      ?? sdkFailedReplyTailStart(orderedSuffix, failedInputs, sessionId);
    // Keep validating any earlier residue. Only the proven closed SDK segment
    // is superseded by resumeSessionAt; the underlying JSONL is never edited.
    const unprovenSuffix = interruptedStart === null ? orderedSuffix : orderedSuffix.slice(0, interruptedStart);
    for (const entry of unprovenSuffix) {
      const toolResult = entry.type === "user" && Array.isArray(entry.message?.content)
        && entry.message.content.length > 0
        && entry.message.content.every(block => block?.type === "tool_result");
      if (entry.type === "user" && !toolResult) {
        if (userMessageUuid && entry.uuid === userMessageUuid) {
          sameCanonicalTurn = true;
          failedInputOnly = false;
        } else if (failedInputs.has(entry.uuid)) {
          sameCanonicalTurn = false;
          failedInputOnly = true;
        } else throw conflict();
      } else if (failedInputOnly && entry.type !== "attachment") {
        // A failed receipt proves the input, not that generated output is safe to discard.
        throw conflict();
      } else if ((entry.type === "assistant" || toolResult) && !sameCanonicalTurn) {
        throw conflict();
      }
    }
    // A failed/interrupted tail for this exact canonical user UUID is the
    // existing re-delivery case, not a different Desktop conversation turn.
  }

  async #requireCheckpoint(
    sessionId,
    checkpointId,
  ) {
    const id = nonblankString(sessionId);
    if (
      !this.sessionStore
      && this.localCheckpointAncestry
        .get(id)
        ?.has(checkpointId)
    ) {
      return {
        prefix: null,
        ancestry: this.localCheckpointAncestry.get(id),
        cached: true,
      };
    }

    const allEntries =
      await this.#checkpointEntries(sessionId, true);
    const verified =
      durableCheckpointPrefix(allEntries, checkpointId);
    if (!this.sessionStore && id) {
      this.localCheckpointAncestry.set(
        id,
        verified.ancestry,
      );
    }
    return {
      ...verified,
      cached: false,
    };
  }

  async #completedCheckpoint(
    sessionId,
    required,
    parentCheckpointId,
  ) {
    let allEntries;
    try {
      allEntries =
        await this.#checkpointEntries(sessionId, required);
    } catch (cause) {
      if (required) throw cause;
      return null;
    }
    const entries = this.#chainEntries(allEntries);
    const id = entries.at(-1)?.uuid ?? null;
    if (required && (!id || id === parentCheckpointId)) {
      throw runtimeError(
        "Claude turn has no new persisted provider checkpoint.",
        {
          runtimeCode: "NO_PROVIDER_SESSION",
          providerSessionId: sessionId,
        },
      );
    }
    if (!this.sessionStore && id) {
      try {
        const verified =
          durableCheckpointPrefix(allEntries, id);
        this.localCheckpointAncestry.set(
          sessionId,
          verified.ancestry,
        );
      } catch (cause) {
        this.localCheckpointAncestry.delete(sessionId);
        if (required) throw cause;
      }
    }
    return id;
  }

  async #validateRecoveredCheckpoint(sessionId, checkpointId, parentCheckpointId, portability) {
    if (!portability.checkpointRecovered) return;
    const entries = await this.#checkpointEntries(sessionId, true);
    const { ancestry } = durableCheckpointPrefix(entries, checkpointId);
    if (!ancestry.has(parentCheckpointId) || portability.recoveryCheckpointIds.has(checkpointId)) {
      throw runtimeError("Claude recovery has no newly mirrored canonical checkpoint continuation.", { runtimeCode: "NO_PROVIDER_SESSION" });
    }
  }

  async #requireSession(sessionId, checkpointId = null) {
    const id = nonblankString(sessionId);
    if (!id) {
      throw runtimeError(
        "Claude Agent SDK parent session id is required.",
        { runtimeCode: "NO_PROVIDER_SESSION" },
      );
    }

    const getSessionMessages = await this.#resolveSessionMessages();
    let messages;
    try {
      messages = await getSessionMessages(id, {
        dir: this.cwd,
        limit: 1,
      });
    } catch (cause) {
      throw runtimeError(
        `Failed to inspect Claude Agent SDK parent session: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }

    const localAvailable =
      Array.isArray(messages) && messages.length > 0;
    const status = await this.#readPortabilityStatus(id);

    if (localAvailable) {
      return {
        localAvailable: true,
        status,
      };
    }

    if (
      (status !== "complete" && !(status === "incomplete" && checkpointId))
      || !this.sessionStore
      || typeof this.sessionStore.load !== "function"
    ) {
      throw runtimeError(
        "Claude Agent SDK parent session has no complete durable transcript.",
        {
          runtimeCode: "NO_PROVIDER_SESSION",
          parentSessionId: id,
        },
      );
    }

    let remote;
    try {
      remote = await this.sessionStore.load({
        projectKey: this.cwd,
        sessionId: id,
      });
    } catch (cause) {
      throw runtimeError(
        `Failed to inspect durable Claude Agent SDK parent session: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
    if (!Array.isArray(remote) || remote.length === 0) {
      throw runtimeError(
        "Claude Agent SDK parent session has no complete durable transcript.",
        {
          runtimeCode: "NO_PROVIDER_SESSION",
          parentSessionId: id,
        },
      );
    }

    return {
      localAvailable: false,
      status,
      ...(status === "incomplete" && checkpointId ? {
        checkpointRecovered: Boolean(durableCheckpointPrefix(remote, checkpointId)),
        recoveryCheckpointIds: new Set(this.#chainEntries(remote).map(entry => entry.uuid)),
      } : {}),
    };
  }

  async #prepareSessionForTurn(sessionId, mode, checkpointId = null, recoverIncomplete = true, allowBackfill = true) {
    const id = nonblankString(sessionId);
    const exactCheckpoint = checkpointId !== null;
    const preflight = await this.#requireSession(id, recoverIncomplete ? checkpointId : null);
    if (!allowBackfill && (!preflight.localAvailable || preflight.status !== "complete")) {
      throw runtimeError("Original native source and complete durable baseline are required.", { runtimeCode: "NO_PROVIDER_SESSION" });
    }
    let status = preflight.status;
    let backfillStatus = "not_needed";
    let backfillFailureReason = null;

    if (
      allowBackfill && preflight.localAvailable
      && (status === null || (status === "incomplete" && exactCheckpoint))
    ) {
      const backfill = await this.#tryBackfillLocalSession(id);
      status = backfill.status;
      backfillStatus = backfill.backfillStatus;
      backfillFailureReason = backfill.failureReason;
    }

    if (exactCheckpoint && this.sessionStore && status !== "complete" && !preflight.checkpointRecovered) {
      throw runtimeError("Exact Claude checkpoint parent could not be made durable and complete.", {
        runtimeCode: "RUNTIME_UNAVAILABLE", parentSessionId: id,
      });
    }
    // A recovered same-session tail stays globally incomplete. A fork creates
    // a new session from a proven prefix and can complete after verified mirror.
    const canComplete = status === "complete" || (mode === "fork" && preflight.checkpointRecovered);

    if (mode === "resume" && canComplete) {
      if (
        !this.sessionStore
        || typeof this.sessionStore.markIncomplete !== "function"
      ) {
        throw runtimeError(
          "Durable Claude Agent SDK session cannot be marked incomplete before mutation.",
          { runtimeCode: "RUNTIME_UNAVAILABLE" },
        );
      }
      try {
        await this.sessionStore.markIncomplete(id);
      } catch (cause) {
        throw runtimeError(
          `Failed to mark durable Claude Agent SDK session incomplete: ${cause instanceof Error ? cause.message : String(cause)}`,
          { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
        );
      }
    }

    return {
      canComplete,
      parentLocalAvailable: preflight.localAvailable,
      parentStatusBefore: preflight.status,
      backfillStatus,
      backfillFailureReason,
      checkpointRecovered: preflight.checkpointRecovered ?? false,
      recoveryCheckpointIds: preflight.recoveryCheckpointIds,
    };
  }

  async #tryBackfillLocalSession(sessionId) {
    if (
      !this.sessionStore
      || typeof this.sessionStore.load !== "function"
      || typeof this.sessionStore.markComplete !== "function"
    ) {
      return {
        status: null,
        backfillStatus: "unavailable",
        failureReason:
          "Durable SessionStore backfill helpers are unavailable.",
      };
    }

    let importSessionToStore;
    try {
      importSessionToStore =
        this.importSessionToStoreImpl
        ?? await this.loadImportSessionToStore();
    } catch (cause) {
      this.events.emit("session-store-backfill-error", cause);
      return {
        status: null,
        backfillStatus: "unavailable",
        failureReason: clippedSessionStoreReason(cause),
      };
    }

    try {
      await importSessionToStore(
        sessionId,
        this.sessionStore,
        {
          dir: this.cwd,
          includeSubagents: true,
          batchSize: 500,
        },
      );
      const entries = await this.sessionStore.load({
        projectKey: this.cwd,
        sessionId,
      });
      if (!Array.isArray(entries) || entries.length === 0) {
        const cause = new Error(
          "SessionStore backfill produced no readable transcript.",
        );
        this.events.emit("session-store-backfill-error", cause);
        return {
          status: null,
          backfillStatus: "failed",
          failureReason: cause.message,
        };
      }
      await this.sessionStore.markComplete(sessionId);
      return {
        status: "complete",
        backfillStatus: "complete",
        failureReason: null,
      };
    } catch (cause) {
      this.events.emit("session-store-backfill-error", cause);
      return {
        status: null,
        backfillStatus: "failed",
        failureReason: clippedSessionStoreReason(cause),
      };
    }
  }

  async #readPortabilityStatus(sessionId) {
    if (
      !this.sessionStore
      || typeof this.sessionStore.getStatus !== "function"
    ) {
      return null;
    }
    try {
      const status = await this.sessionStore.getStatus(sessionId);
      if (
        status !== null
        && status !== "complete"
        && status !== "incomplete"
      ) {
        throw new Error("SessionStore returned an invalid portability status.");
      }
      return status;
    } catch (cause) {
      throw runtimeError(
        `Failed to inspect durable Claude Agent SDK session status: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  async #completePortability(
    sessionId,
    canComplete,
    mirrorFailureReason,
    alreadyIncomplete = false,
  ) {
    const id = nonblankString(sessionId);
    if (!id || !this.sessionStore) {
      return {
        statusAfter: null,
        statusFailureReason: null,
      };
    }

    let statusAfter = null;
    let statusFailureReason = null;

    if (mirrorFailureReason) {
      if (
        typeof this.sessionStore.discardPendingAppends === "function"
      ) {
        this.sessionStore.discardPendingAppends(id);
      }

      if (alreadyIncomplete) {
        statusAfter = "incomplete";
      } else if (
        typeof this.sessionStore.markIncomplete === "function"
      ) {
        try {
          await this.sessionStore.markIncomplete(id);
          statusAfter = "incomplete";
        } catch (cause) {
          statusFailureReason =
            clippedSessionStoreReason(cause);
          this.events.emit("session-store-status-error", cause);
        }
      } else {
        statusFailureReason =
          "SessionStore markIncomplete() is unavailable.";
      }
    } else if (
      canComplete
      && typeof this.sessionStore.load === "function"
      && typeof this.sessionStore.markComplete === "function"
    ) {
      try {
        const entries = await this.sessionStore.load({
          projectKey: this.cwd,
          sessionId: id,
        });
        if (Array.isArray(entries) && entries.length > 0) {
          await this.sessionStore.markComplete(id);
          statusAfter = "complete";
        }
      } catch (cause) {
        statusFailureReason =
          clippedSessionStoreReason(cause);
        this.events.emit("session-store-status-error", cause);
      }
    }

    if (
      statusAfter === null
      && statusFailureReason === null
      && typeof this.sessionStore.getStatus === "function"
    ) {
      try {
        const observed =
          await this.sessionStore.getStatus(id);
        if (
          observed === null
          || observed === "complete"
          || observed === "incomplete"
        ) {
          statusAfter = observed;
        } else {
          throw new Error(
            "SessionStore returned an invalid portability status.",
          );
        }
      } catch (cause) {
        statusFailureReason ??=
          clippedSessionStoreReason(cause);
        this.events.emit("session-store-status-error", cause);
      }
    }

    return {
      statusAfter,
      statusFailureReason,
    };
  }

  async #resolveListSessions() {
    if (this.listSessionsImpl) return this.listSessionsImpl;
    try {
      this.listSessionsImpl = await this.loadListSessions();
      return this.listSessionsImpl;
    } catch (cause) {
      throw runtimeError(
        `Failed to load Claude Agent SDK listSessions(): ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  async #resolveSessionMessages() {
    if (this.sessionMessagesImpl) return this.sessionMessagesImpl;
    try {
      this.sessionMessagesImpl = await this.loadSessionMessages();
      return this.sessionMessagesImpl;
    } catch (cause) {
      throw runtimeError(
        `Failed to load Claude Agent SDK getSessionMessages(): ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  async #resolveDeleteSession() {
    if (this.deleteSessionImpl) return this.deleteSessionImpl;
    try {
      this.deleteSessionImpl = await this.loadDeleteSession();
      return this.deleteSessionImpl;
    } catch (cause) {
      throw runtimeError(
        `Failed to load Claude Agent SDK deleteSession(): ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  async #resolveQuery() {
    if (this.queryImpl) return this.queryImpl;
    try {
      this.queryImpl = await this.loadQuery();
      return this.queryImpl;
    } catch (cause) {
      throw runtimeError(
        `Failed to load Claude Agent SDK: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  async #run(
    prompt, options = {},
  ) {
    return this.#withLegacyAdmission(() => this.#runAdmitted(prompt, options));
  }

  async #runAdmitted(
    prompt,
    {
      mode = "new",
      parentProviderSessionId = null,
      parentProviderCheckpointId = null,
      requireProviderCheckpoint = false,
      resume = null,
      forkSession = false,
      execution = null,
      verbatimPrompts = true,
      captureContextUsage = true,
      hooks = null,
    } = {},
  ) {
    if (this.activeQuery || this.activeTurnHandle || this.activeSessionHost) {
      throw runtimeError(
        "Claude Agent SDK transport already has an active turn.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }

    if (parentProviderCheckpointId !== null) {
      await this.#requireCheckpoint(parentProviderSessionId, parentProviderCheckpointId);
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
        portability = await this.#prepareSessionForTurn(
          parentProviderSessionId,
          mode,
          parentProviderCheckpointId,
          false,
        );
      } catch (cause) {
        throw attachSessionStoreHealth(
          cause,
          sessionStoreHealthSnapshot({
            configured: Boolean(this.sessionStore),
            mode,
            cwd: this.cwd,
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

    this.abortRequested = false;
    const queryImpl = await this.#resolveQuery();
    if (this.abortRequested) {
      throw runtimeError(
        "Claude Agent SDK turn was aborted before startup completed.",
        { runtimeCode: "ABORTED" },
      );
    }

    const executionOptions =
      normalizeAgentSdkExecutionSelection(execution);

    const options = {
      cwd: this.cwd,
      env: this.environment,
      ...(this.toolPermissionPolicy === "auto_allow" ? {
        permissionMode: "default",
        canUseTool: createAgentSdkPermissionCallback({ toolPermissionPolicy: this.toolPermissionPolicy }),
      } : {}),
      ...(this.chromeEnabled ? { extraArgs: { chrome: null } } : {}),
      settingSources: ["user", "project", "local"],
      ...(this.artifactEnabled ? { settings: { enableArtifact: true } } : {}),
      verbatimPrompts,
      ...executionOptions,
      ...leileiosMcpQueryOptions(this.mcpServerConfig),
      ...(resume ? { resume } : {}),
      ...(parentProviderCheckpointId ? { resumeSessionAt: parentProviderCheckpointId } : {}),
      ...(forkSession ? { forkSession: true } : {}),
      ...(this.sessionStore
        ? { sessionStore: forkSession
          ? checkpointForkSessionStore(this.sessionStore, resume, parentProviderCheckpointId)
          : this.sessionStore }
        : {}),
      ...(hooks ? { hooks } : {}),
    };

    let activeQuery;
    try {
      activeQuery = queryImpl({ prompt, options });
    } catch (cause) {
      throw runtimeError(
        `Failed to start Claude Agent SDK query: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }

    if (!activeQuery || typeof activeQuery[Symbol.asyncIterator] !== "function") {
      throw runtimeError(
        "Claude Agent SDK query() did not return an async iterable.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }

    this.activeQuery = activeQuery;
    const parsedEvents = [];
    const normalizedEvents = [];
    const normalizer = new ClaudeEventNormalizer({
      logicalConversationId: null,
      mode,
      parentProviderSessionId,
    });
    let providerSessionId = null;
    let terminalFailure = null;
    let rawContextUsage = null;
    let contextUsageError = null;
    let rawExecutionSettings = null;
    let rawSupportedModels = null;
    let executionReadbackError = null;
    let executionReadbackSampled = false;
    let mirrorFailureReason = null;

    try {
      for await (const message of activeQuery) {
        parsedEvents.push(message);
        if (sdkMirrorFailed(message)) {
          mirrorFailureReason =
            sdkMirrorFailureReason([message])
            ?? mirrorFailureReason;
        }
        providerSessionId =
          providerSessionId
          ?? nonblankString(message?.session_id)
          ?? nonblankString(message?.sessionId);

        this.events.emit("event", message);
        const nextNormalizedEvents = normalizer.normalize(message);
        normalizedEvents.push(...nextNormalizedEvents);
        for (const normalizedEvent of nextNormalizedEvents) {
          this.events.emit("normalized-event", normalizedEvent);
        }

        if (
          execution
          && !executionReadbackSampled
          && message?.type === "assistant"
        ) {
          executionReadbackSampled = true;
          try {
            if (typeof activeQuery.getSettings === "function") {
              rawExecutionSettings = await activeQuery.getSettings();
            } else {
              throw new Error(
                "Claude Agent SDK Query does not expose getSettings().",
              );
            }

            if (typeof activeQuery.supportedModels === "function") {
              rawSupportedModels =
                await activeQuery.supportedModels();
            }
          } catch (cause) {
            executionReadbackError =
              cause instanceof Error ? cause.message : String(cause);
          }
        }

        if (
          captureContextUsage
          && (
            message?.type === "assistant"
            || (
              message?.type === "system"
              && message?.subtype === "compact_boundary"
            )
          )
          && typeof activeQuery.getContextUsage === "function"
        ) {
          try {
            rawContextUsage = await activeQuery.getContextUsage({
              detail: "summary",
            });
            contextUsageError = null;
          } catch (cause) {
            if (!rawContextUsage) {
              contextUsageError =
                cause instanceof Error ? cause.message : String(cause);
            }
          }
        }

        if (sdkResultFailed(message)) {
          terminalFailure = message;
        }
      }

      if (
        captureContextUsage
        && typeof activeQuery.getContextUsage === "function"
      ) {
        try {
          rawContextUsage = await activeQuery.getContextUsage({
            detail: "summary",
          });
          contextUsageError = null;
        } catch (cause) {
          if (!rawContextUsage) {
            contextUsageError =
              cause instanceof Error ? cause.message : String(cause);
          }
        }
      }
    } catch (cause) {
      const completionState =
        await this.#completePortability(
          providerSessionId,
          false,
          mirrorFailureReason,
          mode === "resume" && portability.canComplete,
        );
      const health = sessionStoreHealthSnapshot({
        configured: Boolean(this.sessionStore),
        mode,
        cwd: this.cwd,
        sessionId: providerSessionId,
        parentSessionId: parentProviderSessionId,
        portability,
        completion: completionState,
        mirrorFailureReason,
      });
      if (this.abortRequested) {
        throw runtimeError(
          "Claude Agent SDK turn was aborted.",
          {
            runtimeCode: "ABORTED",
            cause,
            events: parsedEvents,
            normalizedEvents,
            sessionStoreObservability: health,
          },
        );
      }
      throw runtimeError(
        `Claude Agent SDK query failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          cause,
          events: parsedEvents,
          normalizedEvents,
          sessionStoreObservability: health,
        },
      );
    } finally {
      if (this.activeQuery === activeQuery) {
        this.activeQuery = null;
      }
    }

    if (this.abortRequested || terminalFailure) {
      const completionState =
        await this.#completePortability(
          providerSessionId,
          false,
          mirrorFailureReason,
          mode === "resume" && portability.canComplete,
        );
      const health = sessionStoreHealthSnapshot({
        configured: Boolean(this.sessionStore),
        mode,
        cwd: this.cwd,
        sessionId: providerSessionId,
        parentSessionId: parentProviderSessionId,
        portability,
        completion: completionState,
        mirrorFailureReason,
      });
      if (this.abortRequested) {
        throw runtimeError(
          "Claude Agent SDK turn was aborted.",
          {
            runtimeCode: "ABORTED",
            events: parsedEvents,
            normalizedEvents,
            sessionStoreObservability: health,
          },
        );
      }
      throw runtimeError(
        sdkFailureMessage(terminalFailure),
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          result: terminalFailure,
          events: parsedEvents,
          normalizedEvents,
          sessionStoreObservability: health,
        },
      );
    }

    if (mode === "fork" && providerSessionId === parentProviderSessionId) {
      throw runtimeError("Claude Agent SDK fork returned the same provider session id as its parent.", {
        runtimeCode: "PROVIDER_SESSION_CONFLICT", providerSessionId,
      });
    }
    if (mode === "resume" && providerSessionId !== parentProviderSessionId) {
      throw runtimeError("Claude Agent SDK returned conflicting provider session identity.", {
        runtimeCode: "PROVIDER_SESSION_CONFLICT", providerSessionId,
      });
    }
    if (requireProviderCheckpoint && mirrorFailureReason) {
      throw runtimeError("Compact checkpoint transcript mirror failed.", {runtimeCode: "RUNTIME_UNAVAILABLE"});
    }
    const providerCheckpointId = mirrorFailureReason ? null : await this.#completedCheckpoint(providerSessionId, requireProviderCheckpoint, parentProviderCheckpointId);
    const completionState =
      await this.#completePortability(
        providerSessionId,
        portability.canComplete,
        mirrorFailureReason,
        mode === "resume" && portability.canComplete,
      );
    if (requireProviderCheckpoint && this.sessionStore && completionState.statusAfter !== "complete") {
      throw runtimeError("Compact checkpoint did not become durable and complete.", {runtimeCode: "RUNTIME_UNAVAILABLE"});
    }
    const sessionStoreObservability =
      sessionStoreHealthSnapshot({
        configured: Boolean(this.sessionStore),
        mode,
        cwd: this.cwd,
        sessionId: providerSessionId,
        parentSessionId: parentProviderSessionId,
        portability,
        completion: completionState,
        mirrorFailureReason,
      });

    this.events.emit("exit", {
      code: 0,
      signal: null,
    });

    const contextUsage =
      normalizeAgentSdkContextUsage(rawContextUsage);
    const executionReadback =
      execution
        ? normalizeAgentSdkExecutionReadback({
            requested: execution,
            settings: rawExecutionSettings,
            supportedModels: rawSupportedModels,
          })
        : null;

    return {
      providerSessionId,
      providerCheckpointId,
      events: parsedEvents,
      normalizedEvents,
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
  }
}
