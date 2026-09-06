import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

type BridgeEvent = {
  id: string;
  visibleText: string;
  modelContext?: string;
  kind?: string;
  source?: string;
  reservedAt?: string | null;
  dispatchStartedAt?: string | null;
};

type BridgeToolResult = {
  isError?: boolean;
  structuredContent?: {
    success?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string };
  };
  _meta?: { bridgeEvent?: BridgeEvent };
};

type BridgeRuntimeConfig = {
  ambiguityAcceptanceEnabled?: boolean;
  ambiguityAcceptancePrefix?: string;
};

type BridgeListenerApi = {
  call: (method: string, params?: Record<string, unknown>, timeout?: number) => Promise<unknown>;
  initializeHost: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  sync: (source?: string) => Promise<void>;
  diagnostics: () => string[];
};

declare global {
  interface Window {
    __LEILEIOS_BRIDGE_CONFIG__?: BridgeRuntimeConfig;
    bridgeListener?: BridgeListenerApi;
  }
}

const POLL_MS = 10_000;
const RENEW_MS = 30_000;
const TIMEOUT_MS = 18_000;
const DIAG_LIMIT = 24;
const DEFAULT_AMBIGUITY_PREFIX = "PHASE2 AMBIGUOUS E2E ";

function startBridgeListener(): void {
  const config = window.__LEILEIOS_BRIDGE_CONFIG__ ?? {};
  const ambiguityAcceptanceEnabled = config.ambiguityAcceptanceEnabled === true;
  const ambiguityAcceptancePrefix = config.ambiguityAcceptancePrefix ?? DEFAULT_AMBIGUITY_PREFIX;
  const listenerInstanceId = crypto.randomUUID();
  const app = new App(
    { name: "LeileiOS Message Bridge", version: "1.0.0" },
    {},
    { autoResize: true, strict: true },
  );
  const transport = new PostMessageTransport(window.parent, window.parent);
  const pendingAppCalls = new Set<Promise<unknown>>();
  const diagLines: string[] = [];
  let nextAppCall = 0;
  let connectionPromise: Promise<void> | null = null;
  let supported = false;
  let missingCapabilities: string[] = [];
  let running = false;
  let starting = false;
  let syncing = false;
  let tearingDown = false;
  let teardownComplete = false;
  let eventInFlight: { event: BridgeEvent; messageAttempted: boolean } | null = null;
  let pendingSyncReservation: Promise<BridgeEvent | undefined> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let renewTimer: ReturnType<typeof setInterval> | null = null;

  const startButton = document.querySelector<HTMLButtonElement>("[data-bridge-start]");
  const stopButton = document.querySelector<HTMLButtonElement>("[data-bridge-stop]");
  const syncButton = document.querySelector<HTMLButtonElement>("[data-bridge-sync]");
  const statusNode = document.querySelector<HTMLElement>("[data-bridge-status]");
  const occupiedNode = document.querySelector<HTMLElement>("[data-bridge-occupied]");
  const diagNode = document.querySelector<HTMLElement>("[data-bridge-diag]");

  const recordDiag = (message: string): void => {
    const stamp = new Date().toISOString().slice(11, 23);
    diagLines.push(`${stamp} ${String(message)}`);
    while (diagLines.length > DIAG_LIMIT) diagLines.shift();
    if (diagNode) {
      diagNode.textContent = diagLines.join("\n");
      diagNode.scrollTop = diagNode.scrollHeight;
    }
  };

  const errorSummary = (error: unknown): string => {
    if (!error) return "unknown";
    const candidate = error as { code?: string | number; message?: string };
    const code = typeof candidate.code === "string" || typeof candidate.code === "number" ? String(candidate.code) : "";
    const rawMessage = typeof candidate.message === "string" ? candidate.message : typeof error === "string" ? error : "";
    const message = rawMessage.replace(/\s+/g, " ").slice(0, 120);
    return `${code ? `code=${code}` : ""}${code && message ? " " : ""}${message || (!code ? "unknown" : "")}`;
  };

  const setUiState = (state: "idle" | "connecting" | "starting" | "running" | "occupied" | "unsupported" | "unavailable"): void => {
    const labels = {
      idle: "Idle",
      connecting: "Connecting to host…",
      starting: "Starting",
      running: "Running",
      occupied: "Occupied",
      unsupported: `Unsupported host${missingCapabilities.length ? ` (missing ${missingCapabilities.join(", ")})` : ""}`,
      unavailable: "Host connection unavailable",
    };
    if (statusNode) statusNode.textContent = labels[state];
    if (occupiedNode) occupiedNode.hidden = state !== "occupied";
    if (startButton) startButton.disabled = state === "connecting" || state === "starting" || state === "running" || state === "unsupported" || state === "unavailable";
    if (stopButton) stopButton.disabled = state !== "running";
    if (syncButton) syncButton.disabled = state !== "running";
  };

  const hasTextCapability = (capabilities: Record<string, unknown> | undefined, name: string): boolean => {
    const value = capabilities?.[name];
    return typeof value === "object" && value !== null && "text" in value;
  };

  const detectMissingCapabilities = (): string[] => {
    const capabilities = app.getHostCapabilities() as Record<string, unknown> | undefined;
    const missing: string[] = [];
    if (!capabilities?.serverTools) missing.push("serverTools");
    if (!hasTextCapability(capabilities, "updateModelContext")) missing.push("updateModelContext.text");
    if (!hasTextCapability(capabilities, "message")) missing.push("message.text");
    return missing;
  };

  const initializeHost = async (): Promise<void> => {
    if (connectionPromise) return connectionPromise;
    recordDiag("app.connect enter");
    connectionPromise = app.connect(transport)
      .then(() => {
        missingCapabilities = detectMissingCapabilities();
        supported = missingCapabilities.length === 0;
        if (supported) {
          setUiState("idle");
          recordDiag("app.connect success; required capabilities ready");
        } else {
          setUiState("unsupported");
          recordDiag(`app.connect success; missing ${missingCapabilities.join(", ")}`);
        }
      })
      .catch((error: unknown) => {
        setUiState("unavailable");
        recordDiag(`app.connect failed ${errorSummary(error)}`);
        throw Object.assign(new Error("MCP Apps host connection failed"), { code: "HOST_INIT_FAILED", cause: error });
      });
    return connectionPromise;
  };

  const trackAppCall = <T>(promise: Promise<T>): Promise<T> => {
    const tracked = promise.finally(() => pendingAppCalls.delete(tracked));
    pendingAppCalls.add(tracked);
    return tracked;
  };

  const appCall = async (name: string, args?: Record<string, unknown>): Promise<BridgeToolResult> => {
    const callNumber = ++nextAppCall;
    const bridgeArgs = { listenerInstanceId, ...(args ?? {}) };
    recordDiag(`${name} call=${callNumber}`);
    const result = await trackAppCall(app.callServerTool({ name, arguments: bridgeArgs }, { timeout: TIMEOUT_MS })) as BridgeToolResult;
    const structured = result?.structuredContent;
    if (!result || result.isError === true || !structured || structured.success !== true) {
      const code = structured?.error?.code;
      const error = Object.assign(new Error("Bridge tool call failed"), { code: code || "BRIDGE_UNAVAILABLE" });
      recordDiag(`${name} semantic error ${errorSummary(error)}`);
      throw error;
    }
    return result;
  };

  const report = async (name: string, args?: Record<string, unknown>): Promise<void> => {
    try {
      await appCall(name, args);
    } catch (error) {
      recordDiag(`${name} report failed ${errorSummary(error)}`);
    }
  };

  const schedulePoll = (): void => {
    if (!running || tearingDown || pollTimer) return;
    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void sync("poll");
    }, POLL_MS) as unknown as ReturnType<typeof setTimeout>;
  };

  const sentinelWakeMetadata = (event: BridgeEvent): Record<string, unknown> | null => {
    if (event.kind !== "wake" || event.source !== "leileios_sentinel" || typeof event.modelContext !== "string") return null;
    const match = event.modelContext.match(/wakeId=([^;]+); sentinelId=([^;]+); controlRevision=(\d+); scheduledFor=([^ ]+)\./);
    if (!match) return null;
    return {
      eventId: event.id,
      wakeId: match[1],
      sentinelId: match[2],
      controlRevision: Number(match[3]),
      scheduledFor: match[4],
      reservedAt: event.reservedAt ?? null,
      dispatchStartedAt: event.dispatchStartedAt ?? null,
    };
  };

  const modelContextFor = (event: BridgeEvent): string => {
    const wake = sentinelWakeMetadata(event);
    return wake
      ? `LeileiOS Sentinel event metadata: eventId=${event.id}; wakeId=${wake.wakeId}; sentinelId=${wake.sentinelId}; controlRevision=${wake.controlRevision}; scheduledFor=${wake.scheduledFor}.`
      : `${event.modelContext ?? ""}\n\nLeileiOS Bridge event metadata: eventId=${event.id}.`;
  };

  const definiteTransportRejection = (error: unknown): boolean => {
    const candidate = error as { code?: unknown; message?: unknown };
    const code = candidate && typeof candidate.code === "number" ? candidate.code : null;
    if (code === -32_000 || code === -32_001) return false;
    const message = typeof candidate?.message === "string" ? candidate.message : String(error ?? "");
    return !/timeout|timed out|connection closed|not connected|transport/i.test(message);
  };

  const sendMessage = async (event: BridgeEvent): Promise<void> => {
    const acceptanceMode = ambiguityAcceptanceEnabled && event.visibleText.startsWith(ambiguityAcceptancePrefix);
    const messagePromise = trackAppCall(app.sendMessage({
      role: "user",
      content: [{ type: "text", text: `@LeileiOS ${event.visibleText}` }],
    }, { timeout: TIMEOUT_MS }));
    if (!acceptanceMode) {
      try {
        const result = await messagePromise as { isError?: boolean } | undefined;
        if (result?.isError === true) throw Object.assign(new Error("Host rejected ui/message"), { ambiguous: false });
        if (result == null) throw Object.assign(new Error("Host ui/message outcome was ambiguous"), { ambiguous: true });
      } catch (error) {
        if ((error as { ambiguous?: boolean } | undefined)?.ambiguous !== undefined) throw error;
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { ambiguous: !definiteTransportRejection(error) });
      }
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(Object.assign(new Error("Host ui/message outcome was ambiguous"), { ambiguous: true })), TIMEOUT_MS);
      messagePromise.then((result) => {
        if ((result as { isError?: boolean } | undefined)?.isError === true) {
          window.clearTimeout(timeout);
          reject(Object.assign(new Error("Host rejected ui/message"), { ambiguous: false }));
        }
        // The acceptance hook intentionally keeps a successful host response ambiguous.
      }).catch((error: unknown) => {
        window.clearTimeout(timeout);
        reject(Object.assign(error instanceof Error ? error : new Error(String(error)), { ambiguous: !definiteTransportRejection(error) }));
      });
      void resolve;
    });
  };

  const sync = async (source = "auto"): Promise<void> => {
    recordDiag(`sync enter source=${source} running=${running} syncing=${syncing}`);
    if (!running || !supported || tearingDown || syncing) {
      recordDiag(`sync skipped ${!running ? "not-running" : !supported ? "unsupported" : tearingDown ? "teardown" : "already-running"}`);
      return;
    }
    syncing = true;
    try {
      const reservation = (async (): Promise<BridgeEvent | undefined> => {
        const result = await appCall("bridge_listener_sync");
        const event = result._meta?.bridgeEvent;
        if (event && !eventInFlight) eventInFlight = { event, messageAttempted: false };
        return event;
      })();
      pendingSyncReservation = reservation;
      let event: BridgeEvent | undefined;
      try {
        event = await reservation;
      } finally {
        if (pendingSyncReservation === reservation) pendingSyncReservation = null;
      }
      if (!event || eventInFlight?.event !== event) {
        schedulePoll();
        return;
      }
      if (tearingDown) return;
      try {
        const wakeMetadata = sentinelWakeMetadata(event);
        const contextResult = await trackAppCall(app.updateModelContext({
          content: [{ type: "text", text: modelContextFor(event) }],
          ...(wakeMetadata ? { _meta: { leileios: { bridgeEvent: wakeMetadata } } } : {}),
        }, { timeout: TIMEOUT_MS }));
        if ((contextResult as { isError?: boolean } | undefined)?.isError === true) throw new Error("Host rejected ui/update-model-context");
      } catch (error) {
        recordDiag(`context update failed ${errorSummary(error)}`);
        await report("bridge_listener_release", { eventId: event.id, safeErrorCode: "CONTEXT_UPDATE_FAILED" });
        eventInFlight = null;
        schedulePoll();
        return;
      }
      if (tearingDown) return;
      try {
        await appCall("bridge_listener_dispatch_started", { eventId: event.id });
      } catch (error) {
        recordDiag(`dispatch start failed ${errorSummary(error)}`);
        if (!(error as { ambiguous?: boolean } | undefined)?.ambiguous) await report("bridge_listener_release", { eventId: event.id, safeErrorCode: "DISPATCH_START_FAILED" });
        eventInFlight = null;
        schedulePoll();
        return;
      }
      if (tearingDown || !eventInFlight) return;
      eventInFlight.messageAttempted = true;
      try {
        await sendMessage(event);
      } catch (error) {
        recordDiag(`ui/message failed ${errorSummary(error)}`);
        if ((error as { ambiguous?: boolean } | undefined)?.ambiguous) await report("bridge_listener_delivery_unknown", { eventId: event.id, safeErrorCode: "UI_MESSAGE_AMBIGUOUS" });
        else await report("bridge_listener_release", { eventId: event.id, safeErrorCode: "UI_MESSAGE_REJECTED" });
        eventInFlight = null;
        schedulePoll();
        return;
      }
      if (tearingDown) return;
      await report("bridge_listener_delivered", { eventId: event.id });
      eventInFlight = null;
      schedulePoll();
    } catch (error) {
      recordDiag(`sync failed source=${source} ${errorSummary(error)}`);
      schedulePoll();
    } finally {
      syncing = false;
    }
  };

  const renew = async (source: string): Promise<void> => {
    if (!running || tearingDown) return;
    recordDiag(`renew tick source=${source}`);
    try {
      await appCall("bridge_listener_start");
      await sync(source);
    } catch (error) {
      recordDiag(`renew failed source=${source} ${errorSummary(error)}`);
    }
  };

  const stopTimers = (): void => {
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (renewTimer) {
      window.clearInterval(renewTimer);
      renewTimer = null;
    }
  };

  const stop = async (): Promise<void> => {
    recordDiag("stop enter");
    if (!running && !starting) return;
    running = false;
    starting = false;
    stopTimers();
    setUiState("idle");
    await report("bridge_listener_stop");
    recordDiag("stop complete");
  };

  const teardown = async (): Promise<{}> => {
    if (teardownComplete) return {};
    teardownComplete = true;
    tearingDown = true;
    const wasRunning = running || starting;
    running = false;
    starting = false;
    stopTimers();
    if (pendingSyncReservation) await pendingSyncReservation.catch(() => undefined);
    const inFlight = eventInFlight;
    eventInFlight = null;
    if (inFlight) {
      await report(
        inFlight.messageAttempted ? "bridge_listener_delivery_unknown" : "bridge_listener_release",
        { eventId: inFlight.event.id, safeErrorCode: inFlight.messageAttempted ? "TEARDOWN_DURING_MESSAGE" : "TEARDOWN_BEFORE_MESSAGE" },
      );
    }
    if (wasRunning) await report("bridge_listener_stop");
    setUiState("idle");
    recordDiag("app teardown complete");
    // The SDK sends the ui/resource-teardown response after this handler resolves;
    // closing the transport here would abort that response. The host owns final disposal.
    return {};
  };

  app.onteardown = teardown;
  window.bridgeListener = {
    call: async (method, params, timeout = TIMEOUT_MS) => {
      await initializeHost();
      if (method === "tools/call") return app.callServerTool(params as { name: string; arguments?: Record<string, unknown> }, { timeout });
      if (method === "ui/update-model-context") return app.updateModelContext(params as never, { timeout });
      if (method === "ui/message") return app.sendMessage(params as never, { timeout });
      throw new Error(`Unsupported direct App method: ${method}`);
    },
    initializeHost,
    start: async () => {
      if (running || starting || tearingDown) return;
      starting = true;
      setUiState("starting");
      try {
        await initializeHost();
        if (!supported) throw Object.assign(new Error("Host lacks required Message Bridge capabilities"), { code: "HOST_CAPABILITY_UNSUPPORTED" });
        await appCall("bridge_listener_start");
        running = true;
        starting = false;
        setUiState("running");
        renewTimer = window.setInterval(() => { void renew("timer"); }, RENEW_MS) as unknown as ReturnType<typeof setInterval>;
        await sync("start");
      } catch (error) {
        recordDiag(`start failed ${errorSummary(error)}`);
        running = false;
        starting = false;
        setUiState((error as { code?: string } | undefined)?.code === "LISTENER_BUSY" ? "occupied" : (error as { code?: string } | undefined)?.code === "HOST_CAPABILITY_UNSUPPORTED" ? "unsupported" : "idle");
        throw error;
      }
    },
    stop,
    sync,
    diagnostics: () => diagLines.slice(),
  };

  startButton?.addEventListener("click", () => { void window.bridgeListener?.start().catch(() => undefined); });
  stopButton?.addEventListener("click", () => { void window.bridgeListener?.stop(); });
  syncButton?.addEventListener("click", () => { void window.bridgeListener?.sync("manual"); });
  window.addEventListener("focus", () => { if (running) void renew("focus"); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && running) void renew("visibility"); });
  recordDiag("iframe ready");
  void initializeHost().catch(() => undefined);
}

startBridgeListener();
