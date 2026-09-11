import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerSharedPaperAppTool,
} from "../src/mcp/tools/shared-paper-app/register.js";
import {
  CHATGPT_SHARED_PAPER_APP_RESOURCE_URI,
  SHARED_PAPER_APP_RESOURCE_URI,
  createSharedPaperAppHtml,
  registerSharedPaperAppResource,
} from "../src/mcp/tools/shared-paper-app/resource.js";
import {
  buildUniqueEditReplacement,
} from "../src/mcp/tools/shared-paper-app/browser-runtime.js";
import { createProductionMcpSessionServerFactory } from "../src/mcp/server/production-server-factory.js";

async function connect(server: McpServer, name: string) {
  const client = new Client({ name, version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("Shared Paper MCP App opener is a strict model-visible resource tool", async () => {
  const server = new McpServer({ name: "shared-paper-app-tool", version: "1" });
  registerSharedPaperAppTool(server);
  const pair = await connect(server, "shared-paper-app-tool-client");
  try {
    const listed = await pair.client.listTools();
    const tool = listed.tools.find((candidate) => candidate.name === "open_shared_paper_app");
    assert.ok(tool);
    assert.equal(tool?._meta?.ui?.resourceUri, SHARED_PAPER_APP_RESOURCE_URI);
    assert.deepEqual(tool?._meta?.ui?.visibility, ["model", "app"]);
    assert.equal(tool?._meta?.["openai/outputTemplate"], CHATGPT_SHARED_PAPER_APP_RESOURCE_URI);

    const result = await pair.client.callTool({
      name: "open_shared_paper_app",
      arguments: {
        id: "50db8771-8a75-44d6-9c91-7cc974d1ae93",
        scope: "archived",
      },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      success: true,
      data: {
        status: "opened",
        paper_id: "50db8771-8a75-44d6-9c91-7cc974d1ae93",
        scope: "archived",
      },
    });

    const invalid = await pair.client.callTool({
      name: "open_shared_paper_app",
      arguments: { scope: "all" },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});

test("Shared Paper MCP App resource exposes identical portable and ChatGPT aliases", async () => {
  const server = new McpServer({ name: "shared-paper-app-resource", version: "1" });
  registerSharedPaperAppResource(server);
  const pair = await connect(server, "shared-paper-app-resource-client");
  try {
    const listed = await pair.client.listResources();
    assert.deepEqual(
      listed.resources.map((resource) => resource.uri).sort(),
      [CHATGPT_SHARED_PAPER_APP_RESOURCE_URI, SHARED_PAPER_APP_RESOURCE_URI].sort(),
    );
    const [portable, chatgpt] = await Promise.all([
      pair.client.readResource({ uri: SHARED_PAPER_APP_RESOURCE_URI }),
      pair.client.readResource({ uri: CHATGPT_SHARED_PAPER_APP_RESOURCE_URI }),
    ]);
    assert.equal(portable.contents[0]?.mimeType, "text/html;profile=mcp-app");
    assert.equal(chatgpt.contents[0]?.mimeType, "text/html;profile=mcp-app");
    assert.equal(portable.contents[0]?.text, chatgpt.contents[0]?.text);
    assert.deepEqual((portable.contents[0]?._meta as any)?.ui?.csp, { connectDomains: [], resourceDomains: [] });
    const html = String(portable.contents[0]?.text);
    assert.match(html, /data-shared-paper-app/);
    assert.match(html, /data-paper-search/);
    assert.match(html, /data-paper-scope/);
    assert.match(html, /data-paper-list/);
    assert.match(html, /data-paper-editor/);
    assert.match(html, /data-paper-save/);
    assert.match(html, /data-paper-history/);
    assert.match(html, /data-paper-archive/);
    assert.match(html, /data-paper-restore/);
    assert.match(html, /data-paper-delete/);
    assert.match(html, /Shared Paper/);
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});

function applyReplacement(source: string, matchText: string, replacementText: string): string {
  if (matchText === "") {
    assert.equal(source, "");
    return replacementText;
  }
  const first = source.indexOf(matchText);
  assert.notEqual(first, -1);
  assert.equal(source.indexOf(matchText, first + 1), -1);
  return source.slice(0, first) + replacementText + source.slice(first + matchText.length);
}

test("Shared Paper App edit replacement preserves a minimal unique contiguous mutation", () => {
  assert.deepEqual(
    buildUniqueEditReplacement("alpha beta gamma", "alpha BETA gamma"),
    { matchText: "beta", replacementText: "BETA" },
  );

  const repeatedInsertion = buildUniqueEditReplacement("aaaa", "aaXaa");
  assert.ok(repeatedInsertion);
  assert.notEqual(repeatedInsertion?.matchText, "");
  assert.equal(
    applyReplacement("aaaa", repeatedInsertion!.matchText, repeatedInsertion!.replacementText),
    "aaXaa",
  );

  const unicodeInsertion = buildUniqueEditReplacement("你🙂好", "你🙂世界好");
  assert.ok(unicodeInsertion);
  assert.equal(
    applyReplacement("你🙂好", unicodeInsertion!.matchText, unicodeInsertion!.replacementText),
    "你🙂世界好",
  );

  assert.deepEqual(
    buildUniqueEditReplacement("", "第一行\n第二行"),
    { matchText: "", replacementText: "第一行\n第二行" },
  );
  assert.equal(buildUniqueEditReplacement("same", "same"), null);
});

test("production public surface registers Shared Paper App opener while internal stays tool-only", async () => {
  const factory = createProductionMcpSessionServerFactory({
    activeUserRepository: { findUserById: async () => ({ status: "active" }) },
    memoryService: {} as never,
    diaryService: {} as never,
    taskService: {} as never,
    toyCommandService: {} as never,
    globalSearchService: {} as never,
    todoService: {} as never,
    universeService: {} as never,
    healthService: {} as never,
    sharedPaperService: {} as never,
  });

  const publicPair = await connect(factory("user-1", "public"), "shared-paper-app-public");
  const internalPair = await connect(factory("user-1", "internal"), "shared-paper-app-internal");
  try {
    const publicNames = (await publicPair.client.listTools()).tools.map((tool) => tool.name);
    const internalNames = (await internalPair.client.listTools()).tools.map((tool) => tool.name);
    assert.equal(publicNames.includes("open_shared_paper_app"), true);
    assert.equal(internalNames.includes("open_shared_paper_app"), false);
  } finally {
    await publicPair.client.close();
    await publicPair.server.close();
    await internalPair.client.close();
    await internalPair.server.close();
  }
});

test("Shared Paper MCP App HTML has bounded CSP and theme-aware paper chrome", () => {
  const html = createSharedPaperAppHtml();
  assert.match(html, /color-scheme:\s*light dark/);
  assert.match(html, /data-theme="dark"/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
});
