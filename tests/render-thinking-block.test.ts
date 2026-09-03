import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JSDOM } from "jsdom";
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
    assert.equal(tool._meta?.["openai/outputTemplate"], RENDER_THINKING_BLOCK_RESOURCE_URI);
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
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});

function createCardDom(openai: Record<string, unknown>): JSDOM {
  return new JSDOM(createRenderThinkingBlockHtml(), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, "openai", { value: openai, writable: true });
      Object.defineProperty(window, "ResizeObserver", {
        value: class {
          observe() {}
          disconnect() {}
        },
      });
      window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
      window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
    },
  });
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
    dom.window.dispatchEvent(new dom.window.CustomEvent("openai:set_globals", {
      detail: { globals: { toolInput: { style: "relational", thinking: "PARTIAL_INPUT" } } },
    }));
    assert.equal(thinking.textContent, "PARTIAL_INPUT");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-style-badge]")?.textContent, "relational");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-effort-badge]")?.textContent, "effort: low");
    dom.window.dispatchEvent(new dom.window.CustomEvent("openai:set_globals", {
      detail: { globals: { toolInput: { thinking: "SECOND_PARTIAL" } } },
    }));
    assert.equal(thinking.textContent, "SECOND_PARTIAL");
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-style-badge]")?.textContent, "relational");
    dom.window.dispatchEvent(new dom.window.CustomEvent("openai:set_globals", {
      detail: { globals: { toolOutput: { thinking: outputThinking, effort: "medium" } } },
    }));
    assert.equal(thinking.textContent, outputThinking);
    assert.equal(dom.window.document.querySelector<HTMLElement>("[data-effort-badge]")?.textContent, "effort: medium");
    dom.window.dispatchEvent(new dom.window.CustomEvent("openai:set_globals", {
      detail: {
        globals: {
          toolResponseMetadata: { mcp_tool_result: { _meta: { thinking: resultThinking, skin: "microglow" } } },
          theme: "dark",
        },
      },
    }));
    await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
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
    await new Promise<void>((resolve) => first.window.setTimeout(resolve, 0));
    assert.ok(notifyCalls.length >= 1);
    first.window.document.querySelector<HTMLButtonElement>("[data-thinking-toggle]")!.click();
    assert.equal(firstCard.dataset.collapsed, "true");
    assert.equal(secondCard.dataset.collapsed, undefined);
    first.window.dispatchEvent(new first.window.CustomEvent("openai:set_globals", { detail: { globals: { theme: "light" } } }));
    assert.equal(first.window.document.documentElement.dataset.theme, "light");
    await new Promise<void>((resolve) => first.window.setTimeout(resolve, 0));
  } finally {
    first.window.close();
    second.window.close();
  }
});
