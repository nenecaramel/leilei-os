import {
  App,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

type RecordValue = Record<string, unknown>;
type ToolInputParams = { arguments?: RecordValue };
type HostContext = RecordValue & {
  theme?: "light" | "dark";
  platform?: string;
  containerDimensions?: { height?: number; maxHeight?: number };
};

type NoteCardApp = {
  ontoolinput?: (params: ToolInputParams) => void;
  ontoolinputpartial?: (params: ToolInputParams) => void;
  ontoolresult?: (params: RecordValue) => void;
  onhostcontextchanged?: (params: HostContext) => void;
  connect: (transport?: Transport) => Promise<void>;
  getHostContext?: () => HostContext | undefined;
};

export type NoteCardController = {
  render: (event?: { detail?: { globals?: RecordValue } }) => void;
  setCollapsed: (value: boolean) => void;
  handleToolInput: (argumentsValue?: RecordValue) => void;
  handleToolInputPartial: (argumentsValue?: RecordValue) => void;
  handleToolResult: (result: RecordValue) => void;
  handleHostContext: (context: RecordValue) => void;
};

type NoteCardWindow = Window & {
  openai?: RecordValue;
  noteCard?: NoteCardController;
  __LEILEIOS_DISABLE_NOTE_CARD_CONNECT__?: boolean;
};

function objectOrEmpty(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function stringValue(source: RecordValue, key: string): string {
  return typeof source[key] === "string" ? source[key] as string : "";
}

function mergeFallbackGlobals(
  base: RecordValue,
  bridge: RecordValue,
  event: RecordValue,
): RecordValue {
  const merged = { ...base, ...bridge, ...event };
  for (const key of ["toolInput", "toolOutput", "toolResult", "toolResponseMetadata", "toolResultMetadata"]) {
    const previous = objectOrEmpty(base[key]);
    const current = objectOrEmpty(bridge[key]);
    const explicit = objectOrEmpty(event[key]);
    if (Object.keys(previous).length || Object.keys(current).length || Object.keys(explicit).length) {
      merged[key] = { ...current, ...previous, ...explicit };
    }
  }
  return merged;
}

function pick(sources: readonly RecordValue[], key: string, fallback: string): string {
  for (const source of sources) {
    const value = stringValue(source, key);
    if (value) return value;
  }
  return fallback;
}

function resultMetadata(result: RecordValue): RecordValue[] {
  const response = objectOrEmpty(result.toolResponseMetadata || result.toolResultMetadata);
  const output = objectOrEmpty(result.toolOutput || result.toolResult);
  const structured = objectOrEmpty(result.structuredContent);
  const data = objectOrEmpty(structured.data);
  const meta = objectOrEmpty(result._meta);
  return [
    objectOrEmpty(objectOrEmpty(response.mcp_tool_result)._meta),
    objectOrEmpty(objectOrEmpty(response.call_tool_result)._meta),
    objectOrEmpty(response._meta),
    response,
    meta,
    objectOrEmpty(objectOrEmpty(meta.mcp_tool_result)._meta),
    objectOrEmpty(objectOrEmpty(meta.call_tool_result)._meta),
    data,
    structured,
    objectOrEmpty(output._meta),
    output,
  ].filter((value) => Object.keys(value).length > 0);
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function installNoteCardRuntime(
  app: NoteCardApp,
  windowRef: NoteCardWindow,
  documentRef: Document,
): NoteCardController | null {
  const card = documentRef.querySelector<HTMLElement>("[data-note-card]");
  const content = documentRef.querySelector<HTMLElement>("[data-note-content]");
  const toggle = documentRef.querySelector<HTMLButtonElement>("[data-note-toggle]");
  const meta = documentRef.querySelector<HTMLElement>("[data-note-meta]");
  if (!card || !content || !toggle || !meta) return null;

  let collapsed = false;
  let heightFrame = 0;
  let lastMeasuredHeight = -1;
  let fallbackGlobals: RecordValue = {};
  let standardInput: RecordValue = {};
  let standardResult: RecordValue = {};
  let hostContext: RecordValue = {};

  const requestIntrinsicHeight = (force = false): void => {
    const host = fallbackGlobals;
    if (typeof host.notifyIntrinsicHeight !== "function") return;
    if (heightFrame) windowRef.cancelAnimationFrame(heightFrame);
    heightFrame = windowRef.requestAnimationFrame(() => {
      const measuredHeight = Math.ceil(documentRef.documentElement.scrollHeight);
      if (!force && measuredHeight === lastMeasuredHeight) return;
      lastMeasuredHeight = measuredHeight;
      try { (host.notifyIntrinsicHeight as () => void)(); } catch (_) {}
    });
  };

  const applyHostContext = (): void => {
    const theme = stringValue(hostContext, "theme") || stringValue(fallbackGlobals, "theme");
    if (theme === "light" || theme === "dark") documentRef.documentElement.dataset.theme = theme;
    const platform = stringValue(hostContext, "platform");
    if (platform) documentRef.documentElement.dataset.platform = platform;
    const dimensions = objectOrEmpty(hostContext.containerDimensions);
    const maxHeight = finitePositive(dimensions.maxHeight)
      ?? finitePositive(dimensions.height)
      ?? finitePositive(fallbackGlobals.maxHeight);
    if (!maxHeight) {
      content.style.maxHeight = "";
      delete content.dataset.scrollable;
      return;
    }
    const chromeHeight = toggle.getBoundingClientRect().height + 58;
    content.style.maxHeight = `${Math.max(180, Math.floor(maxHeight - chromeHeight))}px`;
    content.dataset.scrollable = "true";
  };

  const render = (event?: { detail?: { globals?: RecordValue } }): void => {
    fallbackGlobals = mergeFallbackGlobals(
      fallbackGlobals,
      objectOrEmpty(windowRef.openai),
      objectOrEmpty(event?.detail?.globals),
    );
    const fallbackInput = objectOrEmpty(fallbackGlobals.toolInput);
    const fallbackOutput = objectOrEmpty(fallbackGlobals.toolOutput || fallbackGlobals.toolResult);
    const mergedInput = { ...fallbackInput, ...standardInput };
    const mergedOutput = { ...fallbackOutput, ...standardResult };
    const sources = [
      standardResult,
      standardInput,
      ...resultMetadata(fallbackGlobals),
      mergedOutput,
      mergedInput,
      fallbackInput,
      fallbackOutput,
    ];
    const style = pick(sources, "style", "plain");
    const detail = pick(sources, "detail", pick(sources, "detail", ""));
    const note = pick(
      sources,
      "note",
      pick(sources, "note", "本轮没有提供笔记。"),
    );
    const normalizedStyle = style === "warm" ? "warm" : "plain";
    meta.textContent = detail ? `${normalizedStyle} · ${detail}` : normalizedStyle;
    content.textContent = note;
    applyHostContext();
    requestIntrinsicHeight(true);
  };

  const setCollapsed = (value: boolean): void => {
    collapsed = Boolean(value);
    card.dataset.collapsed = collapsed ? "true" : "false";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.textContent = collapsed ? "展开" : "折叠";
    requestIntrinsicHeight(true);
  };

  const handleToolInput = (argumentsValue?: RecordValue): void => {
    standardInput = { ...standardInput, ...objectOrEmpty(argumentsValue) };
    render();
  };
  const handleToolInputPartial = (argumentsValue?: RecordValue): void => {
    standardInput = { ...standardInput, ...objectOrEmpty(argumentsValue) };
    render();
  };
  const handleToolResult = (result: RecordValue): void => {
    for (const source of resultMetadata(result)) standardResult = { ...standardResult, ...source };
    render();
  };
  const handleHostContext = (context: RecordValue): void => {
    hostContext = { ...hostContext, ...context };
    render();
  };

  const controller: NoteCardController = {
    render,
    setCollapsed,
    handleToolInput,
    handleToolInputPartial,
    handleToolResult,
    handleHostContext,
  };
  windowRef.noteCard = controller;
  app.ontoolinput = (params) => handleToolInput(params.arguments);
  app.ontoolinputpartial = (params) => handleToolInputPartial(params.arguments);
  app.ontoolresult = (params) => handleToolResult(params);
  app.onhostcontextchanged = (params) => handleHostContext(params);
  toggle.addEventListener("click", () => setCollapsed(!collapsed));
  windowRef.addEventListener("openai:set_globals", (event) => {
    const detail = (event as CustomEvent<{ globals?: RecordValue }>).detail;
    render({ detail });
  });
  const resizeObserver = (windowRef as Window & typeof globalThis).ResizeObserver;
  if (typeof resizeObserver === "function") new resizeObserver(() => requestIntrinsicHeight()).observe(documentRef.body);
  render();
  return controller;
}

export function startNoteCardApp(
  windowRef: NoteCardWindow = window,
  documentRef: Document = document,
): NoteCardController | null {
  const app = new App(
    { name: "LeileiOS Note Card", version: "1.0.0" },
    {},
    { autoResize: true, strict: true },
  );
  const controller = installNoteCardRuntime(app, windowRef, documentRef);
  if (!controller || windowRef.__LEILEIOS_DISABLE_NOTE_CARD_CONNECT__) return controller;
  const transport = new PostMessageTransport(windowRef.parent, windowRef.parent);
  void app.connect(transport)
    .then(() => {
      const context = app.getHostContext?.();
      if (context) controller.handleHostContext(context);
    })
    .catch(() => undefined);
  return controller;
}

if (typeof window !== "undefined" && typeof document !== "undefined") startNoteCardApp();
