import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createSharedPaperAppHtml } from "../src/mcp/tools/shared-paper-app/resource.js";
import { installSharedPaperAppRuntime } from "../src/mcp/tools/shared-paper-app/browser-runtime.js";

type ToolCall = { name: string; arguments?: Record<string, unknown> };

const paperId = "11111111-1111-4111-8111-111111111111";

function summary(content = "hello", revision = 1, archivedAt: string | null = null) {
  return {
    id: paperId,
    title: "Shared",
    preview: content,
    snippet: null,
    revision,
    created_by: "L",
    updated_by: "L",
    created_at: "2026-09-11T00:00:00.000Z",
    updated_at: "2026-09-11T00:00:00.000Z",
    archived_at: archivedAt,
  };
}

function detail(content = "hello", revision = 1, archivedAt: string | null = null) {
  return { ...summary(content, revision, archivedAt), content };
}

function success(data: Record<string, unknown>) {
  return { structuredContent: { success: true, data } };
}

function failure(code: string, message = code) {
  return {
    isError: true,
    structuredContent: { success: false, error: { code, message } },
  };
}

async function tick(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function createRuntime(
  handler: (call: ToolCall) => Promise<Record<string, unknown>>,
) {
  const dom = new JSDOM(createSharedPaperAppHtml(), { pretendToBeVisual: true });
  const calls: ToolCall[] = [];
  const app = {
    async callServerTool(params: ToolCall) {
      calls.push(params);
      return handler(params);
    },
    async connect() {},
  };
  const controller = installSharedPaperAppRuntime(
    app as never,
    dom.window as never,
    dom.window.document,
  );
  assert.ok(controller);
  controller.markConnected();
  return { dom, calls, controller };
}

test("Shared Paper App browses, edits with revision CAS, and keeps textarea autosized across newlines", async () => {
  let committed = false;
  const runtime = createRuntime(async ({ name }) => {
    if (name === "list_shared_papers") return success({ papers: [summary(committed ? "hello\nworld" : "hello", committed ? 2 : 1)], count: 1 });
    if (name === "get_shared_paper") return success({ paper: detail(committed ? "hello\nworld" : "hello", committed ? 2 : 1) });
    if (name === "edit_shared_paper") {
      committed = true;
      return success({
        paper_id: paperId,
        revision: 2,
        metadata: { idempotent_replay: false },
        detail_tool: "get_shared_paper",
        detail_arguments: { id: paperId },
      });
    }
    throw new Error("unexpected tool " + name);
  });
  try {
    await runtime.controller.reload();
    const row = runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-row]");
    assert.ok(row);
    row.click();
    await tick(2);

    runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-edit]")!.click();
    const textarea = runtime.dom.window.document.querySelector<HTMLTextAreaElement>("[data-paper-editor] textarea")!;
    assert.equal(textarea.value, "hello");
    textarea.value = "hello\nworld";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new runtime.dom.window.Event("input", { bubbles: true }));
    assert.equal(textarea.style.height, "240px");
    assert.equal(textarea.selectionStart, textarea.value.length);

    runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-save]")!.click();
    await tick(4);

    const edit = runtime.calls.find((call) => call.name === "edit_shared_paper");
    assert.ok(edit);
    assert.equal(edit.arguments?.id, paperId);
    assert.equal(edit.arguments?.expected_revision, 1);
    assert.equal(edit.arguments?.author, "L");
    assert.equal(typeof edit.arguments?.idempotency_key, "string");
    assert.notEqual(edit.arguments?.match_text, "");
    assert.equal(runtime.controller.state().revision, 2);
    assert.equal(runtime.controller.state().editing, false);
    assert.equal(
      runtime.dom.window.document.querySelector<HTMLElement>("[data-paper-content]")?.textContent,
      "hello\nworld",
    );
  } finally {
    runtime.dom.window.close();
  }
});

test("Shared Paper App preserves draft on revision conflict and explicitly rebases before retry", async () => {
  let getCount = 0;
  let editCount = 0;
  const runtime = createRuntime(async ({ name, arguments: args }) => {
    if (name === "list_shared_papers") return success({ papers: [summary("alpha", 1)], count: 1 });
    if (name === "get_shared_paper") {
      getCount += 1;
      return success({ paper: getCount === 1 ? detail("alpha", 1) : detail("remote alpha", 2) });
    }
    if (name === "edit_shared_paper") {
      editCount += 1;
      if (editCount === 1) return failure("PAPER_REVISION_CONFLICT", "Shared paper revision conflict.");
      assert.equal(args?.expected_revision, 2);
      return success({
        paper_id: paperId,
        revision: 3,
        metadata: { idempotent_replay: false },
        detail_tool: "get_shared_paper",
        detail_arguments: { id: paperId },
      });
    }
    throw new Error("unexpected tool " + name);
  });
  try {
    await runtime.controller.reload();
    runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-row]")!.click();
    await tick(2);
    runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-edit]")!.click();
    const textarea = runtime.dom.window.document.querySelector<HTMLTextAreaElement>("[data-paper-editor] textarea")!;
    textarea.value = "alpha local";
    textarea.dispatchEvent(new runtime.dom.window.Event("input", { bubbles: true }));
    runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-save]")!.click();
    await tick(4);

    assert.equal(runtime.controller.state().conflict, true);
    assert.equal(runtime.controller.state().revision, 2);
    assert.equal(textarea.value, "alpha local");
    assert.match(runtime.dom.window.document.querySelector<HTMLElement>("[data-paper-status]")!.textContent ?? "", /conflict/);

    runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-keep-draft]")!.click();
    assert.equal(runtime.controller.state().conflict, false);
    assert.equal(runtime.controller.state().editing, true);
    assert.equal(textarea.value, "alpha local");

    runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-save]")!.click();
    await tick(3);
    assert.equal(editCount, 2);
  } finally {
    runtime.dom.window.close();
  }
});

test("Shared Paper App reconciles uncertain archive outcome before refreshing authoritative scope", async () => {
  let archived = false;
  const runtime = createRuntime(async ({ name }) => {
    if (name === "list_shared_papers") {
      return success({ papers: archived ? [] : [summary("hello", 1)], count: archived ? 0 : 1 });
    }
    if (name === "get_shared_paper") {
      return success({ paper: detail("hello", 1, archived ? "2026-09-11T12:00:00.000Z" : null) });
    }
    if (name === "archive_shared_paper") {
      archived = true;
      throw new Error("response lost after commit");
    }
    throw new Error("unexpected tool " + name);
  });
  try {
    await runtime.controller.reload();
    runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-row]")!.click();
    await tick(2);
    runtime.dom.window.document.querySelector<HTMLButtonElement>("[data-paper-archive]")!.click();
    await tick(4);

    assert.equal(runtime.controller.state().selectedId, null);
    assert.equal(
      runtime.dom.window.document.querySelectorAll("[data-paper-row]").length,
      0,
    );
    assert.match(
      runtime.dom.window.document.querySelector<HTMLElement>("[data-paper-status]")!.textContent ?? "",
      /已归档/,
    );
    assert.equal(runtime.calls.filter((call) => call.name === "archive_shared_paper").length, 1);
    assert.ok(runtime.calls.some((call) => call.name === "get_shared_paper"));
  } finally {
    runtime.dom.window.close();
  }
});
