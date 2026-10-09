import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { WebApiError } from "../web/src/api/web-api-error.js";
import { SystemDataPageContent } from "../web/src/pages/SystemDataPageContent.js";
import type {
  WebImportModule,
  WebImportModuleSummary,
  WebImportPreview,
} from "../web/src/system/import-types.js";

function installDom(url: string) {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url },
  );
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "React", "URL"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === "React"
          ? React
          : key === "URL"
            ? dom.window.URL
            : dom.window[key as keyof Window],
    });
  }
  return {
    dom,
    restore() {
      for (const key of ["window", "document", "navigator", "React", "URL"]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

const waitForPaint = () =>
  new Promise((resolve) => setTimeout(resolve, 35));

async function waitFor(
  condition: () => boolean,
  label: string,
  timeoutMs = 1500,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Timed out waiting for ${label}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const summary = () => ({
  success: true as const,
  data: {
    diary: { active: 0, archived: 0 },
    diary_comments: { count: 0 },
    todo: { active: 0, count: 0 },
    workspaces: { count: 0 },
    conversations: { active: 0, archived: 0 },
    mind: { count: 0 },
    universe: { nodes: 0 },
  },
});

const counts = (
  create = 0,
  duplicate = 0,
  conflict = 0,
  invalid = 0,
): WebImportModuleSummary => ({
  create,
  duplicate,
  conflict,
  invalid,
});

function preview(
  modules: WebImportModule[],
  moduleSummary: Partial<
    Record<WebImportModule, WebImportModuleSummary>
  >,
  canExecute = true,
): WebImportPreview {
  return {
    schema_version: 4,
    exported_at: "2026-09-29T07:00:00.000Z",
    raw_bytes: 2048,
    included_modules: modules,
    audit_included: true,
    package_sha256: "a".repeat(64),
    preview_fingerprint: "b".repeat(64),
    summary: moduleSummary,
    can_execute: canExecute,
  };
}

function render(api: WebApiClient) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(SystemDataPageContent, { api }));
  return { container, root };
}

async function selectFile(
  env: ReturnType<typeof installDom>,
  container: HTMLElement,
  name = "backup.json",
) {
  const input = container.querySelector<HTMLInputElement>(
    "input[type=file]",
  )!;
  const file = new env.dom.window.File(
    ["{}"],
    name,
    { type: "application/json" },
  );
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(
    new env.dom.window.Event("change", { bubbles: true }),
  );
}

function findButton(
  container: HTMLElement,
  text: string,
): HTMLButtonElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent?.trim() === text);
}

test("Data restore auto-previews complete v4 metadata and all portable modules", async () => {
  const env = installDom("https://leilei.test/system/data");
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const p = preview(
    [
      "diary",
      "diary_comments",
      "todo",
      "workspaces",
      "conversations",
      "mind",
      "universe",
    ],
    {
      diary: counts(1),
      diary_comments: counts(2),
      todo: counts(3),
      workspaces: counts(4),
      conversations: counts(5),
      mind: counts(6),
      universe: counts(7),
    },
  );

  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (path === "/system/data") return summary() as T;
      if (path === "/system/import/preview") return { data: p } as T;
      return {
        data: {
          ...p,
          summary: p.summary,
        },
      } as T;
    },
  };

  const { container, root } = render(api);
  await waitForPaint();
  await selectFile(env, container);

  await waitFor(
    () => container.textContent?.includes("Backup format") === true,
    "automatic backup preview",
  );

  const card = container.querySelector<HTMLElement>(
    ".system-import-card",
  )!;
  assert.match(card.textContent ?? "", /v4/);
  assert.match(card.textContent ?? "", /Included · diagnostic only/);
  assert.match(card.textContent ?? "", /Mind \(Memory & history\)/);
  for (const label of [
    "Diary",
    "Diary comments",
    "Todo",
    "Workspaces",
    "Conversation records",
    "Mind",
    "Universe",
  ]) {
    assert.match(card.textContent ?? "", new RegExp(label));
  }
  assert.equal(findButton(card, "Preview"), undefined);
  assert.match(card.textContent ?? "", /28 new records/);

  findButton(card, "Restore")!.click();
  await waitFor(
    () => card.textContent?.includes("Restore complete") === true,
    "restore result",
  );

  await waitFor(
    () => calls.filter((call) => call.path === "/system/data").length >= 2,
    "post-restore data summary reload",
  );
  const paths = calls.map((call) => call.path);
  assert.equal(
    paths.filter((path) => path === "/system/data").length,
    2,
  );
  assert.ok(paths.includes("/system/import/preview"));
  assert.ok(
    paths.includes(
      "/system/import/execute?expected_preview_fingerprint="
        + "b".repeat(64),
    ),
  );
  const previewCall = calls.find(
    (call) => call.path === "/system/import/preview",
  );
  assert.ok(previewCall);
  const previewHeaders = previewCall.init?.headers as
    | Record<string, string>
    | undefined;
  assert.equal(
    previewHeaders?.["Content-Type"],
    "application/octet-stream",
  );

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data restore reports duplicate-only backup without offering Restore", async () => {
  const env = installDom("https://leilei.test/system/data");
  const p = preview(
    ["workspaces"],
    { workspaces: counts(0, 2) },
    false,
  );
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      return (
        path === "/system/data"
          ? summary()
          : { data: p }
      ) as T;
    },
  };

  const { container, root } = render(api);
  await waitForPaint();
  await selectFile(env, container);
  await waitFor(
    () => container.textContent?.includes("Everything in this backup is already here") === true,
    "duplicate preview",
  );

  assert.match(container.textContent ?? "", /2 already here/);
  assert.equal(findButton(container, "Restore"), undefined);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data restore names conflicting modules and keeps add-only fail-closed behavior", async () => {
  const env = installDom("https://leilei.test/system/data");
  const p = preview(
    ["workspaces", "mind"],
    {
      workspaces: counts(0, 0, 1),
      mind: counts(0, 0, 0, 2),
    },
    false,
  );
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      return (
        path === "/system/data"
          ? summary()
          : { data: p }
      ) as T;
    },
  };

  const { container, root } = render(api);
  await waitForPaint();
  await selectFile(env, container);
  await waitFor(
    () => container.textContent?.includes("1 conflict") === true,
    "conflict preview",
  );

  const text = container.textContent ?? "";
  assert.match(text, /Workspaces/);
  assert.match(text, /1 conflict/);
  assert.match(text, /Mind/);
  assert.match(text, /2 invalid/);
  assert.match(text, /existing data is never overwritten/);
  assert.equal(findButton(container, "Restore"), undefined);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data restore preserves safe backend validation errors", async () => {
  const env = installDom("https://leilei.test/system/data");
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/data") return summary() as T;
      throw new WebApiError(
        403,
        "IMPORT_OWNER_MISMATCH",
        "Import package does not belong to this account.",
      );
    },
  };
  const { container, root } = render(api);
  await waitForPaint();
  await selectFile(env, container);
  await waitFor(
    () => container.textContent?.includes(
      "Import package does not belong to this account.",
    ) === true,
    "safe validation error",
  );

  assert.ok(findButton(container, "Choose"));

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data restore hides unknown internal validation details", async () => {
  const env = installDom("https://leilei.test/system/data");
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/data") return summary() as T;
      throw new Error("internal details");
    },
  };
  const { container, root } = render(api);
  await waitForPaint();
  await selectFile(env, container);
  await waitFor(
    () => container.textContent?.includes(
      "Unable to validate this backup file.",
    ) === true,
    "generic validation fallback",
  );

  assert.doesNotMatch(container.textContent ?? "", /internal details/);

  root.unmount();
  await waitForPaint();
  env.restore();
});
