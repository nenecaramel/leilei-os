import { recoverCompletedNativeTurn } from "./completed-turn-recovery.mjs";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { observeNativeSessionStartup } from "./native-session-startup-identity.mjs";
import { durableCheckpointPrefix } from "./provider-checkpoint-prefix.mjs";
import { createAgentSdkSessionHost } from "./agent-sdk-session-host.mjs";
import { createScheduledInputGuard, nativeAutonomousCommandId } from "./agent-sdk-scheduled-input.mjs";
import { createAgentSdkQuestionCallback } from "./agent-sdk-question.mjs";
import { createAgentSdkPermissionCallback } from "./agent-sdk-permission.mjs";
import { normalizeAgentSdkExecutionSelection } from "./agent-sdk-execution-selection.mjs";
import { normalizeAgentSdkContextUsage } from "./agent-sdk-context-observability.mjs";
import { normalizeAgentSdkExecutionReadback } from "./agent-sdk-execution-readback.mjs";
import {
  runtimeError,
  leileiosMcpQueryOptions,
} from "./agent-sdk-transport-support.mjs";

// State stays on the transport owner; private checkpoint operations are bound by its entry point.
export async function openAgentSdkPersistentSession(owner, checkpoints, options = {}, restore = null) {
    const allowed = new Set(["authorize", "onBackgroundResult", "createBackgroundOutput", "execution", "permissionHandler", "questionHandler", "perTaskStopAffordance", "onCloseDiagnostic"]);
    for (const key of Object.keys(options)) if (!allowed.has(key)) throw new Error(`Unsupported persistent session option: ${key}`);
    const { authorize, onBackgroundResult, createBackgroundOutput = null, execution = null, permissionHandler = null,
      questionHandler = null, perTaskStopAffordance = false, onCloseDiagnostic = null } = options;
    if (typeof authorize !== "function" || typeof onBackgroundResult !== "function") throw new Error("Persistent sessions require authorize and onBackgroundResult handlers.");
    let currentExecution = execution;
    if (createBackgroundOutput !== null && typeof createBackgroundOutput !== "function") throw new Error("Invalid background output factory.");
    if (typeof perTaskStopAffordance !== "boolean") throw new Error("Task stop capability must be boolean.");
    if (owner.activeQuery || owner.activeTurnHandle || owner.activeSessionHost || owner.legacyOperation) throw runtimeError("Claude transport already has an active session.", { runtimeCode: "RUNTIME_UNAVAILABLE" });
    const claim = { cancelled: false, reason: null, close: async reason => { if (!claim.cancelled) claim.reason = reason; claim.cancelled = true; } };
    owner.activeSessionHost = claim;
    let host, startup = null, rejectStartup = null;
    let firstInputAdmitted = false;
    const assertLive = phase => {
      if (owner.activeSessionHost !== (host ?? claim) || claim.cancelled || (phase !== "input" && !host)
        || host?.queryClosed || ["closed", "failed"].includes(host?.state)
        || (restore && phase !== "input" && !startup?.nativeIdentityConfirmed)) throw new Error("Persistent session admission was aborted.");
    };
    const admit = async (phase, inputId = null, source = null) => {
      assertLive(phase);
      if (await authorize({ phase, inputId, source, providerSessionId: host?.sessionId ?? restore?.sessionId ?? null }) !== true) throw new Error("Persistent session admission denied.");
      assertLive(phase);
    };
    // An Edit rewinds its session in place; every other restore continues the tail.
    const validateRestoreTail = () => restore.rewind
      ? checkpoints.validateLocalRewindTail(restore.sessionId, restore.checkpointId)
      : checkpoints.validateLocalResumeTail(restore.sessionId, restore.checkpointId, null, []);
    try {
      if (restore) {
        await admit("input", restore.inputId, restore.source);
        await checkpoints.requireSession(restore.sessionId);
        await checkpoints.requireCheckpoint(restore.sessionId, restore.checkpointId);
        await validateRestoreTail();
      }
      const queryImpl = await checkpoints.resolveQuery();
      if (owner.activeSessionHost !== claim || claim.cancelled) throw runtimeError("Persistent session startup was aborted.", { runtimeCode: "ABORTED" });
      let startupReady = null;
      if (restore) {
        // Re-read after asynchronous SDK loading: the ancestry cache cannot
        // prove Desktop has not advanced the source transcript in the meantime.
        await admit("input", restore.inputId, restore.source);
        await validateRestoreTail();
        assertLive("input");
        startupReady = new Promise((resolve, reject) => {
          rejectStartup = reject;
          startup = { parentProviderSessionId: restore.sessionId, initialUserMessageUuid: restore.inputId,
            startupReceipt: JSON.stringify({ continue: true, suppressOutput: true, stopReason: `native-resume-${randomUUID()}` }),
            nativeIdentityConfirmed: false, nativeStartupReceiptConfirmed: false,
            settleNativeIdentity: accepted => accepted ? resolve() : reject(new Error("Native startup identity was rejected.")) };
        });
        startupReady.catch(() => {});
      }
      // One-use PreToolUse admission belongs to an exact native selection,
      // not merely the foreground slot waiting behind autonomous work.
      const toolAdmissions = new Map();
      const toolOwner = () => {
        const turn = host?.active ?? null;
        return { turn, nativeCommand: host?.currentCommandUuid ?? null,
          inputId: nativeAutonomousCommandId(host) ?? turn?.id ?? null };
      };
      const sameToolOwner = (left, right) => left && right
        && left.turn === right.turn && left.nativeCommand === right.nativeCommand && left.inputId === right.inputId;
      const assertToolOwner = owner => {
        assertLive("tool");
        if (!sameToolOwner(owner, toolOwner())) throw new Error("Persistent tool native owner changed.");
      };
      const admitToolOwner = async owner => {
        assertToolOwner(owner);
        await admit("tool", owner.inputId);
        assertToolOwner(owner);
      };
      // CLI hook source is optional, not a tool capability. Scheduling tools
      // use the same fresh durable admission before/after permission as all tools.
      const scheduledInput = createScheduledInputGuard({ getHost: () => host,
        admit: nativeCommand => admit("scheduled", nativeCommand, null) });
      const permission = createAgentSdkPermissionCallback({
        toolPermissionPolicy: owner.toolPermissionPolicy, events: owner.events,
        permissionHandler: permissionHandler ?? (async () => ({ decision: "deny", message: "No permission handler is configured.", interrupt: false })),
      });
      const question = questionHandler ? createAgentSdkQuestionCallback({ questionHandler, events: owner.events }) : null;
      // One send_file server for the whole session; authorize by the exact
      // SDK-stamped reply OR the native-started foreground input before its
      // first assistant frame. Background commands cannot borrow that grant.
      const sendFiles = new Map();
      const sendFileServer = await owner.createSendFileMcpServerImpl(async input => {
        const owner = toolOwner();
        const background = host?.backgroundOutputOwner?.() ?? null;
        if (background?.collector.sendFileHandler) {
          if (owner.inputId !== background.commandUuid) throw new Error("send_file background owner is unavailable.");
          await admitToolOwner(owner);
          host.assertBackgroundOutput(background);
          return host.runBackgroundOutput(background, async () => {
            const attachment = await background.collector.sendFileHandler(input);
            assertToolOwner(owner);
            return attachment;
          });
        }
        const id = host?.fileToolOwnerInputId?.() ?? null;
        const handler = id === null ? null : sendFiles.get(id);
        if (!handler) throw new Error("send_file is only available to the turn that owns the current reply.");
        assertLive("tool");
        return handler(input);
      });
      if (owner.activeSessionHost !== claim || claim.cancelled) throw runtimeError("Persistent session startup was aborted.", { runtimeCode: "ABORTED" });
      const executionOptions = normalizeAgentSdkExecutionSelection(execution);
      host = await createAgentSdkSessionHost({ queryImpl, onCloseDiagnostic,
        expectedSessionId: restore?.sessionId ?? null,
        observeOutput: startup ? message => observeNativeSessionStartup(startup, message) : null,
        beforeSubmit: async context => {
          if (restore && !firstInputAdmitted && (context.inputId !== restore.inputId || context.source !== restore.source)) throw new Error("Initial native input identity/source does not match its reservation.");
          await admit("input", context.inputId, context.source);
          firstInputAdmitted = true;
        }, onBackgroundResult, createBackgroundOutput,
        queryOptions: {
          cwd: owner.cwd, env: owner.environment, settingSources: ["user", "project", "local"],
          permissionMode: "default", includePartialMessages: true, perTaskStopAffordance,
          // Only a human /loop opts into native dispatch on its own message.
          // Composed prompts retain literal delivery via client_composed.
          verbatimPrompts: false,
          ...executionOptions,
          // Request the same provider displayable summary as the interactive
          // one-shot path, without changing explicit disabled/between_tools.
          ...(!executionOptions.thinking || executionOptions.thinking.type === "adaptive"
            ? { thinking: { type: "adaptive", display: "summarized" } }
            : {}),
          ...(owner.chromeEnabled ? { extraArgs: { chrome: null } } : {}),
          ...(owner.artifactEnabled ? { settings: { enableArtifact: true } } : {}),
          ...leileiosMcpQueryOptions(owner.mcpServerConfig, sendFileServer),
          ...(owner.sessionStore ? { sessionStore: owner.sessionStore } : {}),
          ...(restore ? { resume: restore.sessionId, resumeSessionAt: restore.checkpointId,
            settings: { ...(owner.artifactEnabled ? { enableArtifact: true } : {}), hooks: { SessionStart: [{ hooks: [{
              type: "command", command: `printf '%s' '${startup.startupReceipt}'`,
            }] }] } },
          } : {}),
          canUseTool: async (name, input, context) => {
            // Capture native selection through admission and permission waits.
            const owner = toolOwner();
            const toolId = context?.toolUseID;
            const admittedOwner = toolAdmissions.get(toolId); toolAdmissions.delete(toolId);
            try {
              if (admittedOwner && !sameToolOwner(admittedOwner, owner)) throw new Error("Stale tool admission.");
              if (!admittedOwner) await admitToolOwner(owner);
              assertToolOwner(owner);
            }
            catch { return { behavior: "deny", message: "LeileiOS session admission denied.", interrupt: true }; }
            const verdict = await (name === "AskUserQuestion"
              ? question ? question(name, input, context) : { behavior: "deny", message: "No question handler is configured.", interrupt: false }
              : permission(name, input, context));
            try { await admitToolOwner(owner); assertToolOwner(owner); }
            catch { return { behavior: "deny", message: "LeileiOS session admission denied.", interrupt: true }; }
            return verdict;
          },
          hooks: { UserPromptSubmit: [{ hooks: [scheduledInput] }], PreToolUse: [{ hooks: [async input => {
            const owner = toolOwner();
            const toolId = input?.tool_use_id;
            toolAdmissions.delete(toolId);
            try {
              await admitToolOwner(owner);
              assertToolOwner(owner);
              if (typeof toolId === "string" && toolId.length <= 512) {
                toolAdmissions.set(toolId, owner);
                if (toolAdmissions.size > 64) toolAdmissions.delete(toolAdmissions.keys().next().value);
              }
              return {};
            }
            catch { return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "LeileiOS session admission denied." } }; }
          }] }] },
        },
      });
      owner.activeSessionHost = host;
      const submit = host.submit.bind(host);
      host.submit = (text, { sendFileHandler = null, ...turn } = {}) => {
        toolAdmissions.clear();
        if (sendFileHandler !== null && typeof sendFileHandler !== "function") return Promise.reject(new Error("Invalid turn output handler."));
        const id = turn.id ?? randomUUID();
        if (sendFileHandler && sendFiles.has(id)) return Promise.reject(new Error('Duplicate session input id.'));
        if (sendFileHandler) sendFiles.set(id, sendFileHandler);
        let completion;
        try { completion = submit(text, { ...turn, id }); }
        catch (error) {
          if (sendFileHandler && sendFiles.get(id) === sendFileHandler) sendFiles.delete(id);
          throw error;
        }
        const release = () => {
          if (sendFileHandler && sendFiles.get(id) === sendFileHandler) sendFiles.delete(id);
        };
        completion.then(release, release);
        return completion.then(async result => {
          // Observability never blocks canonical output indefinitely. Capture
          // before the router acknowledges and admits the next logical turn.
          let settings = null, supportedModels = null, rawUsage = null, readbackError = null;
          let timer;
          try {
            await Promise.race([(async () => {
              if (currentExecution) {
                if (typeof host.query.getSettings !== "function") throw new Error("SDK settings readback unavailable.");
                settings = await host.query.getSettings();
                if (typeof host.query.supportedModels === "function") supportedModels = await host.query.supportedModels();
              }
              if (typeof host.query.getContextUsage === "function") rawUsage = await host.query.getContextUsage({ detail: "summary" });
            })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("SDK readback deadline expired.")), 2_000); })]);
          } catch (error) { readbackError = error instanceof Error ? error.message : String(error); }
          finally { clearTimeout(timer); }
          return { ...result, contextUsage: normalizeAgentSdkContextUsage(rawUsage),
            executionReadback: currentExecution ? normalizeAgentSdkExecutionReadback({ requested: currentExecution, settings, supportedModels }) : null,
            executionReadbackError: readbackError };
        });
      };
      // Desktop's /model and /effort: switch the live session in place so its
      // native tasks keep running. Thinking mode has no live switch.
      host.applyExecutionSelection = async next => {
        const current = normalizeAgentSdkExecutionSelection(currentExecution);
        const wanted = normalizeAgentSdkExecutionSelection(next);
        if (!isDeepStrictEqual(current.thinking, wanted.thinking))
          throw runtimeError("A live session cannot change its thinking mode.", { runtimeCode: "RUNTIME_UNAVAILABLE" });
        if (typeof host.query.setModel !== "function" || typeof host.query.applyFlagSettings !== "function")
          throw runtimeError("SDK live model and effort switching is unavailable.", { runtimeCode: "RUNTIME_UNAVAILABLE" });
        if (wanted.model !== current.model) await host.query.setModel(wanted.model);
        if (wanted.effort !== current.effort) await host.query.applyFlagSettings({ effortLevel: wanted.effort ?? null });
        currentExecution = next;
      };
      // A turn's checkpoint is its last top-level assistant record, accepted only
      // once durably in the local transcript and descended from the previously
      // committed checkpoint. The live CLI may still be writing; wait briefly.
      host.verifyCheckpoint = async ({ events, parentCheckpointId = null, timeoutMs = 3_000, pollMs = 100 } = {}) => {
        const id = [...(Array.isArray(events) ? events : [])].reverse().find(event => event?.type === "assistant"
          && !event.parent_tool_use_id && !event.parent_agent_id && !event.isSidechain
          && typeof event.uuid === "string" && event.uuid.trim())?.uuid ?? null;
        if (!id || id === parentCheckpointId) throw runtimeError("Claude turn has no new persisted provider checkpoint.", { runtimeCode: "NO_PROVIDER_SESSION" });
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          assertLive("input");
          let entries;
          try { entries = await checkpoints.checkpointEntries(host.sessionId, true); }
          catch (cause) {
            if (Date.now() >= deadline) throw runtimeError("Claude turn checkpoint is not durably present.", { runtimeCode: "NO_PROVIDER_SESSION", cause });
            await new Promise(resolve => setTimeout(resolve, pollMs));
            continue;
          }
          // A matching UUID alone does not prove the streamed assistant record
          // is the durable one: reject user/system and sidechain collisions.
          const matches = entries.filter(entry => entry?.uuid === id);
          if (matches.length > 0) {
            if (matches.length !== 1 || matches[0].type !== "assistant" || matches[0].isSidechain
              || (matches[0].sessionId && matches[0].sessionId !== host.sessionId)) {
              throw runtimeError("Claude checkpoint does not identify a unique top-level assistant in this session.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
            }
            let verified;
            try { verified = durableCheckpointPrefix(entries, id); }
            catch (cause) {
              throw runtimeError("Claude checkpoint has invalid durable ancestry.", { runtimeCode: "NO_PROVIDER_SESSION", cause });
            }
            if (parentCheckpointId !== null && !verified.ancestry.has(parentCheckpointId)) {
              throw runtimeError("Claude turn checkpoint does not continue the committed checkpoint.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
            }
            return id;
          }
          if (Date.now() >= deadline) throw runtimeError("Claude turn checkpoint is not durably present.", { runtimeCode: "NO_PROVIDER_SESSION" });
          await new Promise(resolve => setTimeout(resolve, pollMs));
        }
      };
      host.recoverCompletedTurn = async ({inputId, parentCheckpointId}) => {
        if (!host.queryClosed || !host.sessionId || !['closed','failed'].includes(host.state)) return null;
        let timer;
        const deadline=performance.now()+2_000;
        try {
          return await Promise.race([(async () => {
            await host.completion.catch(() => {});
            if(performance.now()>=deadline)return null;
            const entries=await checkpoints.checkpointEntries(host.sessionId,true,{maxEntries:100000,maxBytes:64*1024*1024});
            const recovered=recoverCompletedNativeTurn({entries,sessionId:host.sessionId,inputId,parentCheckpointId});
            if (!recovered || performance.now()>=deadline) return null;
            // A later Desktop write invalidates the snapshot. No native input,
            // network delivery, polling or new writer is started by this reader.
            const again=await checkpoints.checkpointEntries(host.sessionId,true,{maxEntries:100000,maxBytes:64*1024*1024});
            const stable=JSON.stringify(entries)===JSON.stringify(again);
            return stable&&performance.now()<deadline?recovered:null;
          })(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2_000);})]);
        } catch { return null; }
        finally { clearTimeout(timer); }
      };
      const release = () => { if (owner.activeSessionHost === host && host.queryClosed) owner.activeSessionHost = null; };
      const close = host.close.bind(host);
      host.close = async reason => { rejectStartup?.(new Error("Native session startup was closed.")); await close(reason); release(); };
      void host.completion.then(release, release);
      if (claim.cancelled) { await host.close(claim.reason ?? Object.assign(new Error("Session host was closed."), {sessionCloseReason:"STARTUP_ABORTED"})); throw runtimeError("Persistent session startup was aborted.", { runtimeCode: "ABORTED" }); }
      if (startupReady) {
        let timer;
        try {
          await Promise.race([startupReady,
            host.completion.then(() => { throw new Error("Native session ended before startup identity was confirmed."); }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Native startup identity deadline expired.")), restore.timeoutMs); }),
          ]);
        } catch (error) {
          if (!host.queryClosed && host.state !== "failed") await host.close(Object.assign(new Error("Session host was closed."), {sessionCloseReason:"STARTUP_FAILED"}));
          throw error;
        } finally { clearTimeout(timer); }
      }
      if (host.state === "failed") await host.completion;
      assertLive("input");
      return host;
    } catch (error) {
      if (owner.activeSessionHost === claim || (owner.activeSessionHost === host && host.queryClosed)) owner.activeSessionHost = null;
      throw error;
    }
  }
