import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProductionMcpSessionServerFactory } from "../src/mcp/server/production-server-factory.js";
import {
  RENDER_THINKING_BLOCK_RESOURCE_URI,
  createRenderThinkingBlockHtml,
  registerRenderThinkingBlockResource,
} from "../src/mcp/tools/render-thinking-block/resource.js";

const THINKING = "THINKING_SECRET_7f5f8d";
const TOOL_INPUT = {
  style: "deep_think" as const,
  thinking: THINKING,
  effort: "medium" as const,
  skin: "botanical" as const,
};

function createFactory() {
  return createProductionMcpSessionServerFactory({
    activeUserRepository: { findUserById: async () => ({ status: "active" }) },
    memoryService: {} as never,
    diaryService: {} as never,
    taskService: {} as never,
    toyCommandService: {} as never,
    globalSearchService: {} as never,
    todoService: {} as never,
    universeService: {} as never,
    healthService: {} as never,
    bridgeService: {} as never,
    sentinelService: {
      getWakeState: async () => { throw new Error("unused"); },
      completeWake: async () => { throw new Error("unused"); },
      claimCurrentWake: async () => { throw new Error("unused"); },
    } as never,
  });
}

async function connect(server: McpServer, name: string) {
  const client = new Client({ name, version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("authenticated public tools/list exposes the Chinese render_thinking_block contract", async () => {
  const pair = await connect(createFactory()("user-1", "public"), "thinking-contract");
  try {
    const result = await pair.client.listTools();
    const tool = result.tools.find((candidate) => candidate.name === "render_thinking_block");
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required, ["style", "thinking", "effort", "skin"]);
    assert.deepEqual(tool.inputSchema.properties?.style?.enum, ["deep_think", "relational"]);
    assert.match(String(tool.inputSchema.properties?.style?.description), /选择本轮思考块的文体/);
    assert.deepEqual(tool.inputSchema.properties?.effort?.enum, ["low", "medium", "high"]);
    assert.match(String(tool.inputSchema.properties?.effort?.description), /500/);
    assert.match(String(tool.inputSchema.properties?.effort?.description), /700/);
    assert.match(String(tool.inputSchema.properties?.effort?.description), /2000/);
    assert.deepEqual(tool.inputSchema.properties?.skin?.enum, ["botanical", "microglow"]);
    assert.match(String(tool.inputSchema.properties?.skin?.description), /视觉皮肤/);
    assert.match(String(tool.inputSchema.properties?.thinking?.description), /外置的工作文本/);
    assert.match(String(tool.description), /隐藏 CoT|原生/);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.equal(tool._meta?.ui?.resourceUri, RENDER_THINKING_BLOCK_RESOURCE_URI);
    assert.equal(tool._meta?.["openai/outputTemplate"], "ui://widget/leileios-thinking-block-v1.html");
    assert.doesNotMatch(JSON.stringify(tool._meta), /noauth/i);
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});

test("render_thinking_block returns compact content and complete metadata without persistence", async () => {
  const pair = await connect(createFactory()("user-1", "public"), "thinking-call");
  const originalCwd = process.cwd();
  const tempCwd = await mkdtemp(join(tmpdir(), "leileios-thinking-block-"));
  try {
    process.chdir(tempCwd);
    const result = await pair.client.callTool({ name: "render_thinking_block", arguments: TOOL_INPUT });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      success: true,
      data: { status: "rendered" },
    });
    assert.deepEqual(result._meta, TOOL_INPUT);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0]?.type, "text");
    assert.doesNotMatch(String(result.content[0]?.text), new RegExp(THINKING));
    assert.deepEqual(await readdir(tempCwd), []);
  } finally {
    process.chdir(originalCwd);
    await rm(tempCwd, { recursive: true, force: true });
    await pair.client.close();
    await pair.server.close();
  }
});

test("render_thinking_block rejects missing fields and invalid enums without echoing thinking", async () => {
  const pair = await connect(createFactory()("user-1", "public"), "thinking-validation");
  try {
    const invalidEnum = await pair.client.callTool({ name: "render_thinking_block", arguments: { ...TOOL_INPUT, effort: "extreme" } });
    assert.equal(invalidEnum.isError, true);
    assert.match(String(invalidEnum.content[0]?.text), /Input validation error/);
    assert.doesNotMatch(JSON.stringify(invalidEnum), new RegExp(THINKING));
    const missingField = await pair.client.callTool({ name: "render_thinking_block", arguments: { style: "deep_think", thinking: THINKING, effort: "low" } });
    assert.equal(missingField.isError, true);
    assert.match(String(missingField.content[0]?.text), /Input validation error/);
    assert.doesNotMatch(JSON.stringify(missingField), new RegExp(THINKING));
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});

test("render_thinking_block resource has the versioned MCP Apps MIME and static card", async () => {
  assert.equal(RENDER_THINKING_BLOCK_RESOURCE_URI, "ui://widget/leileios-thinking-block-v2.html");
  const server = new McpServer({ name: "resource-test", version: "1" });
  registerRenderThinkingBlockResource(server);
  const pair = await connect(server, "thinking-resource");
  try {
    const result = await pair.client.readResource({ uri: RENDER_THINKING_BLOCK_RESOURCE_URI });
    const content = result.contents[0];
    assert.equal(content.uri, RENDER_THINKING_BLOCK_RESOURCE_URI);
    assert.equal(content.mimeType, "text/html;profile=mcp-app");
    assert.match(String(content.text), /botanical/);
    assert.match(String(content.text), /microglow/);
    assert.match(String(content.text), /notifyIntrinsicHeight/);
    assert.match(String(content.text), /ontoolinput/);
    assert.match(String(content.text), /ontoolinputpartial/);
    assert.match(String(content.text), /ontoolresult/);
    assert.match(String(content.text), /onhostcontextchanged/);
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});

test("render_thinking_block exposes one current HTML resource under the v2 URI and the ChatGPT v1 alias", async () => {
  const v1Uri = "ui://widget/leileios-thinking-block-v1.html";
  const v2Uri = RENDER_THINKING_BLOCK_RESOURCE_URI;
  const server = new McpServer({ name: "resource-alias-test", version: "1" });
  registerRenderThinkingBlockResource(server);
  const pair = await connect(server, "thinking-resource-alias");
  try {
    const listed = await pair.client.listResources();
    assert.deepEqual(
      listed.resources.map((resource) => resource.uri).sort(),
      [v1Uri, v2Uri].sort(),
    );
    const [v1, v2] = await Promise.all([
      pair.client.readResource({ uri: v1Uri }),
      pair.client.readResource({ uri: v2Uri }),
    ]);
    const v1Content = v1.contents[0];
    const v2Content = v2.contents[0];
    assert.ok(v1Content);
    assert.ok(v2Content);
    assert.equal(v1Content.uri, v1Uri);
    assert.equal(v2Content.uri, v2Uri);
    assert.equal(v1Content.mimeType, v2Content.mimeType);
    assert.deepEqual(v1Content._meta, v2Content._meta);
    assert.equal(v1Content.text, v2Content.text);
    assert.match(String(v1Content.text), /ontoolinput/);
    assert.match(String(v1Content.text), /PostMessageTransport/);
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});

test("render_thinking_block compatibility keeps the committed standard browser runtime unchanged", () => {
  const bundle = readFileSync(
    new URL("../src/mcp/tools/render-thinking-block/browser-runtime.js", import.meta.url),
    "utf8",
  );
  assert.equal(
    createHash("sha256").update(bundle).digest("hex"),
    "543203719cbb3aa5a6f96eed6ad6d27983ccc3e187737a5ae7d95a3e21aa0efd",
  );
});

test("standard MCP Apps lifecycle renders authoritative input, result metadata, and host context", () => {
  const dom = createCardDom({
    toolInput: { style: "deep_think", thinking: "fallback", effort: "low", skin: "botanical" },
  });
  try {
    const card = dom.window.thinkingBlock;
    assert.ok(card);
    assert.equal(typeof card?.handleToolInput, "function");
    assert.equal(typeof card?.handleToolInputPartial, "function");
    assert.equal(typeof card?.handleToolResult, "function");
    assert.equal(typeof card?.handleHostContext, "function");
    card?.handleToolInput({
      style: "relational",
      thinking: "standard input",
      effort: "medium",
      skin: "microglow",
    });
    card?.handleToolInputPartial({ thinking: "partial input" });
    card?.handleToolResult({ _meta: { thinking: "authoritative result", effort: "high", skin: "microglow" } });
    card?.handleHostContext({ theme: "dark", containerDimensions: { width: 420, maxHeight: 360 }, platform: "mobile" });
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-thinking-content]")?.textContent, "authoritative result");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-style-badge]")?.textContent, "relational");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-effort-badge]")?.textContent, "effort: high");
    assert.equal(dom.window.document.documentElement.dataset.skin, "microglow");
    assert.equal(dom.window.document.documentElement.dataset.theme, "dark");
    assert.equal(dom.window.document.documentElement.dataset.platform, "mobile");
    assert.match(dom.window.document.querySelector<HTMLElement>("[data-thinking-content]")?.style.maxHeight ?? "", /px$/);
    dispatchGlobals(dom.window, {
      toolInput: { thinking: "stale fallback" },
      toolResponseMetadata: { _meta: { thinking: "stale result fallback", effort: "low", skin: "botanical" } },
      theme: "light",
    });
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-thinking-content]")?.textContent, "authoritative result");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-effort-badge]")?.textContent, "effort: high");
    assert.equal(dom.window.document.documentElement.dataset.skin, "microglow");
    assert.equal(dom.window.document.documentElement.dataset.theme, "dark");
  } finally {
    dom.window.close();
  }
});

type FakeEvent = { detail?: { globals?: Record<string, unknown> } };
type FakeListener = (event: FakeEvent) => void;

class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  textContent = "";
  private readonly listeners = new Map<string, FakeListener[]>();

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  setAttribute(name: string, value: string): void {
    if (name === "aria-expanded") this.dataset.ariaExpanded = value;
  }

  getBoundingClientRect(): { height: number } {
    return { height: 12 };
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener({});
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement();
  readonly body = new FakeElement();
  readonly scrollHeight = 640;
  private readonly elements = new Map<string, FakeElement>([
    ["[data-thinking-card]", new FakeElement()],
    ["[data-thinking-content]", new FakeElement()],
    ["[data-thinking-toggle]", new FakeElement()],
    ["[data-style-badge]", new FakeElement()],
    ["[data-effort-badge]", new FakeElement()],
    ["[data-skin-badge]", new FakeElement()],
  ]);

  querySelector<T extends FakeElement>(selector: string): T | null {
    return (this.elements.get(selector) as T | undefined) ?? null;
  }
}

class FakeWindow {
  readonly document = new FakeDocument();
  readonly listeners = new Map<string, FakeListener[]>();
  readonly requestIntrinsicHeight?: (...args: unknown[]) => void;
  openai: Record<string, unknown>;
  __LEILEIOS_DISABLE_THINKING_BLOCK_CONNECT__ = true;
  thinkingBlock?: {
    render: (event?: FakeEvent) => void;
    setCollapsed: (value: boolean) => void;
    handleToolInput?: (argumentsValue?: Record<string, unknown>) => void;
    handleToolInputPartial?: (argumentsValue?: Record<string, unknown>) => void;
    handleToolResult?: (result: Record<string, unknown>) => void;
    handleHostContext?: (context: Record<string, unknown>) => void;
  };

  constructor(openai: Record<string, unknown>) {
    this.openai = openai;
    this.requestIntrinsicHeight = openai.notifyIntrinsicHeight as typeof this.requestIntrinsicHeight;
  }

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatchEvent(type: string, event: FakeEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  requestAnimationFrame(callback: () => void): number {
    callback();
    return 1;
  }

  cancelAnimationFrame(_handle: number): void {}

  close(): void {}
}

function createCardDom(openai: Record<string, unknown>): { window: FakeWindow } {
  const window = new FakeWindow(openai);
  const context = {
    window,
    document: window.document,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  };
  const script = createRenderThinkingBlockHtml().match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  vm.runInNewContext(script, context, { timeout: 1_000 });
  return { window };
}

function dispatchGlobals(window: FakeWindow, globals: Record<string, unknown>): void {
  window.dispatchEvent("openai:set_globals", { detail: { globals } });
}

test("card renders fields from input, output, and result metadata and merges partial globals", async () => {
  const outputThinking = "OUTPUT_THINKING";
  const resultThinking = "RESULT_THINKING";
  const dom = createCardDom({
    toolInput: { style: "deep_think", thinking: THINKING, effort: "low", skin: "botanical" },
  });
  try {
    const card = dom.window.document.querySelector<HTMLElement>("[data-thinking-card]");
    const thinking = dom.window.document.querySelector<HTMLElement>("[data-thinking-content]");
    assert.ok(card);
    assert.ok(thinking);
    assert.equal(thinking.textContent, THINKING);
    dispatchGlobals(dom.window, { toolInput: { style: "relational", thinking: "PARTIAL_INPUT" } });
    assert.equal(thinking.textContent, "PARTIAL_INPUT");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-style-badge]")?.textContent, "relational");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-effort-badge]")?.textContent, "effort: low");
    dispatchGlobals(dom.window, { toolInput: { thinking: "SECOND_PARTIAL" } });
    assert.equal(thinking.textContent, "SECOND_PARTIAL");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-style-badge]")?.textContent, "relational");
    dispatchGlobals(dom.window, { toolOutput: { thinking: outputThinking, effort: "medium" } });
    assert.equal(thinking.textContent, outputThinking);
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-effort-badge]")?.textContent, "effort: medium");
    dispatchGlobals(dom.window, {
      toolResponseMetadata: { mcp_tool_result: { _meta: { thinking: resultThinking, skin: "microglow" } } },
      theme: "dark",
    });
    assert.equal(thinking.textContent, resultThinking);
    assert.equal(dom.window.document.documentElement.dataset.theme, "dark");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-skin-badge]")?.textContent, "microglow");
  } finally {
    dom.window.close();
  }
});

test("each card owns collapse state, adapts themes, constrains long content, and notifies intrinsic height", async () => {
  const notifyCalls: unknown[] = [];
  const first = createCardDom({
    toolInput: { ...TOOL_INPUT, thinking: "first" },
    theme: "dark",
    maxHeight: 420,
    notifyIntrinsicHeight: (...args: unknown[]) => notifyCalls.push(args),
  });
  const second = createCardDom({ toolInput: { ...TOOL_INPUT, thinking: "second" } });
  try {
    const firstCard = first.window.document.querySelector<HTMLElement>("[data-thinking-card]")!;
    const secondCard = second.window.document.querySelector<HTMLElement>("[data-thinking-card]")!;
    const firstContent = first.window.document.querySelector<HTMLElement>("[data-thinking-content]")!;
    assert.equal(first.window.document.documentElement.dataset.theme, "dark");
    assert.equal(firstContent.dataset.scrollable, "true");
    assert.match(firstContent.style.maxHeight, /px$/);
    assert.ok(notifyCalls.length >= 1);
    first.window.document.querySelector<HTMLButtonElement>("[data-thinking-toggle]")!.click();
    assert.equal(firstCard.dataset.collapsed, "true");
    assert.equal(secondCard.dataset.collapsed, undefined);
    dispatchGlobals(first.window, { theme: "light" });
    assert.equal(first.window.document.documentElement.dataset.theme, "light");
  } finally {
    first.window.close();
    second.window.close();
  }
});
