import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import { NAV_GROUPS } from "../web/src/layout/NavigationGroups.js";
import { WebApiError } from "../web/src/api/web-api-error.js";
import { SentinelPageContent } from "../web/src/pages/SentinelPage.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";

const sentinelSource = readFileSync(new URL("../web/src/pages/SentinelPage.tsx", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../web/src/components/ChatGPTMessageBridgeCard.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://leilei.test/sentinel",
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "React"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "React" ? React : dom.window[key as keyof Window],
    });
  }
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
  return {
    dom,
    restore() {
      for (const key of ["window", "document", "navigator", "React"]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 20));

async function waitForCondition(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await waitForPaint();
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      sentinel: {
        id: "sentinel-id",
        enabled: true,
        timezone: "Asia/Shanghai",
        policyPrompt: "Keep a gentle eye on my workspace.",
        nextWakeAt: "2026-08-30T04:30:00.000Z",
        lastValidWakeAt: "2026-08-30T02:15:00.000Z",
        controlRevision: 3,
      },
      status: "sleeping",
      ...overrides,
    },
  };
}

test("Sentinel loading reuses the standard System state card without moving the header", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = { request: async () => new Promise(() => undefined) };

  try {
    root.render(React.createElement(SentinelPageContent, { api }));
    await waitForCondition(
      () => container.textContent?.includes("Reading...") === true,
      "Sentinel loading state",
    );
    assert.ok(container.querySelector(".system-page.sentinel-page"));
    assert.equal(container.querySelector(".sentinel-page-loading"), null);
    assert.equal(container.querySelector(".sentinel-loading-state"), null);
    assert.equal(container.querySelector(".page-header h1")?.textContent, "Sentinel");
    const loadingCard = container.querySelector("section.system-section");
    assert.ok(loadingCard);
    const loadingState = loadingCard.querySelector(".sentinel-card-state");
    assert.ok(loadingState);
    assert.equal(loadingState.querySelector("p")?.textContent, "Reading...");
    assert.ok(loadingState.querySelector(".sentinel-card-state__action-row"));
  } finally {
    root.unmount();
    await waitForPaint();
    env.restore();
  }
});

test("Sentinel reuses System card, title, button, and native datetime contracts", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    request: async (path, init) => {
      requests.push({ path, init });
      if (path === "/sentinel/wakes?limit=20") return { success: true, data: { wakes: [] } } as never;
      return response({
        status: "paused",
        sentinel: { ...response().data.sentinel, enabled: false },
      }) as never;
    },
  };

  try {
    root.render(React.createElement(SentinelPageContent, { api }));
    await waitForCondition(
      () => container.textContent?.includes("First wake after resume") === true,
      "paused Sentinel controls",
    );

    assert.equal(container.querySelector('input[placeholder="Asia/Shanghai"]'), null);
    const datetime = container.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    assert.ok(datetime?.closest(".native-date-field"));

    for (const label of ["Send", "Save policy", "Resume", "Resume now"] as const) {
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((candidate) => candidate.textContent === label);
      assert.ok(button, `${label} is rendered`);
      assert.ok(button.classList.contains("system-sign-out"), `${label} uses Account button treatment`);
      assert.equal(button.classList.contains("primary-button"), false, `${label} is not primary`);
    }

    for (const title of ["Message Bridge", "Wake Policy", "First Wake / Controls", "Wake Activity"] as const) {
      const heading = [...container.querySelectorAll<HTMLHeadingElement>("h2")]
        .find((candidate) => candidate.textContent === title);
      assert.ok(heading, `${title} heading is rendered`);
      assert.ok(heading.classList.contains("system-product-name"), `${title} uses System title row`);
    }

    assert.doesNotMatch(stylesSource, /\.sentinel-page\s*\{[\s\S]*?gap:\s*16px/);
    const sentinelCardRule = stylesSource.match(
      /\.message-bridge-card,[\s\S]*?\.sentinel-setup-card\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    assert.doesNotMatch(sentinelCardRule, /padding:\s*18px 13px/);
    const actionCardSpacingRule = stylesSource.match(
      /\.system-account-page \.system-section,[\s\S]*?\.sentinel-controls-card\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    assert.match(actionCardSpacingRule, /padding-bottom:\s*13px/);
    assert.doesNotMatch(bridgeSource, /<h2>Message Bridge<\/h2>/);

    const save = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Save policy");
    save?.click();
    await waitForCondition(
      () => requests.some(({ path, init }) => path === "/sentinel" && init?.method === "PUT"),
      "canonical timezone policy save",
    );
    const saveRequest = requests.find(({ path, init }) => path === "/sentinel" && init?.method === "PUT");
    assert.equal(JSON.parse(String(saveRequest?.init?.body)).timezone, "Asia/Shanghai");
    await waitForCondition(
      () => container.querySelector(".sentinel-page")?.getAttribute("aria-busy") === "false",
      "policy save completion",
    );

    assert.match(
      sentinelSource,
      /<NativeDateInput\s+id="sentinel-resume-at"\s+className="sentinel-resume-datetime"\s+type="datetime-local"\s+value=\{resumeAt\}\s+onChange=\{\(event\) => setResumeAt\(event\.target\.value\)\}/,
    );
    const expectedResumeAt = new Date(datetime!.value).toISOString();
    const resume = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Resume");
    resume?.click();
    await waitForCondition(
      () => requests.some(({ path, init }) => path === "/sentinel/resume" && init?.method === "POST"),
      "resume request",
    );
    const resumeRequest = requests.find(({ path, init }) => path === "/sentinel/resume" && init?.method === "POST");
    assert.equal(
      JSON.parse(String(resumeRequest?.init?.body)).next_wake_at,
      expectedResumeAt,
    );
  } finally {
    root.unmount();
    await waitForPaint();
    env.restore();
  }
});

test("Sentinel hides timezone UI while preserving the canonical timezone from readback", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    request: async (path, init) => {
      requests.push({ path, init });
      return path === "/sentinel/wakes?limit=20"
        ? { success: true, data: { wakes: [] } } as never
        : response({ sentinel: { ...response().data.sentinel, timezone: "America/New_York" } }) as never;
    },
  };

  try {
    root.render(React.createElement(SentinelPageContent, { api }));
    await waitForCondition(
      () => container.textContent?.includes("Wake Policy") === true,
      "Sentinel policy readback",
    );
    assert.equal(container.querySelector('input[placeholder="Asia/Shanghai"]'), null);
    assert.equal(container.textContent?.includes("Timezone"), false);
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Save policy");
    assert.ok(save);
    save.click();
    await waitForCondition(
      () => requests.some(({ path, init }) => path === "/sentinel" && init?.method === "PUT"),
      "canonical timezone policy save",
    );
    const saveRequest = requests.find(({ path, init }) => path === "/sentinel" && init?.method === "PUT");
    assert.equal(JSON.parse(String(saveRequest?.init?.body)).timezone, "America/New_York");
  } finally {
    root.unmount();
    await waitForPaint();
    env.restore();
  }
});

test("Sentinel scopes explicit System spacing without a blanket card gap", () => {
  assert.match(
    stylesSource,
    /\.sentinel-page > \.system-section \+ \.system-section\s*\{[\s\S]*?margin-top:\s*12px/,
  );
  assert.match(
    stylesSource,
    /\.system-page \.page-header\s*\{[\s\S]*?padding:\s*0 0 10px/,
  );
  assert.match(
    stylesSource,
    /\.sentinel-status-card \.system-status-list\s*\{[\s\S]*?border-top:\s*1px solid rgba\(0, 0, 0, 0\.08\)/,
  );
  const blanketCardRule = stylesSource.match(
    /\.message-bridge-card,\n\.sentinel-policy-card,\n\.sentinel-controls-card,\n\.sentinel-activity-card,\n\.sentinel-setup-card\s*\{([^}]*)\}/,
  )?.[1] ?? "";
  assert.doesNotMatch(blanketCardRule, /gap:\s*10px/);
  assert.doesNotMatch(stylesSource, /\.message-bridge-card \.system-note\s*\{[\s\S]*?margin-top:\s*12px/);
  assert.match(
    stylesSource,
    /\.message-bridge-card textarea\s*\{[\s\S]*?margin-top:\s*12px/,
  );
  assert.match(
    stylesSource,
    /\.system-account-page \.system-section,[\s\S]*?\.sentinel-controls-card\s*\{[\s\S]*?padding-bottom:\s*13px/,
  );
  assert.match(
    stylesSource,
    /\.system-sign-out,[\s\S]*?margin-top:\s*12px/,
  );
  assert.match(stylesSource, /\.sentinel-first-row\s*\{[\s\S]*?min-height:\s*60px[\s\S]*?align-items:\s*center/);
  assert.match(stylesSource, /\.sentinel-policy-textarea\s*\{[\s\S]*?margin-top:\s*12px/);
  assert.match(stylesSource, /\.sentinel-resume-field\s*\{[\s\S]*?margin-top:\s*12px/);
  assert.match(stylesSource, /\.sentinel-controls-card > \.sentinel-control-row:not\(\.sentinel-first-row\)\s*\{[\s\S]*?margin-top:\s*0/);
  assert.match(
    stylesSource,
    /\.sentinel-controls-card > \.sentinel-control-row:not\(\.sentinel-first-row\) \.system-sign-out\s*\{[^}]*margin-top:\s*16px/,
  );
  assert.match(
    stylesSource,
    /\.sentinel-first-row\.sentinel-control-row \.system-sign-out\s*\{[\s\S]*?margin-top:\s*0/,
  );
  assert.match(stylesSource, /\.sentinel-control-row\s*\{[\s\S]*?gap:\s*10px/);
  assert.match(
    stylesSource,
    /\.sentinel-activity-empty\s*\{[\s\S]*?min-height:\s*60px[\s\S]*?align-items:\s*center[\s\S]*?margin:\s*0[\s\S]*?padding:\s*0/,
  );
  assert.match(
    stylesSource,
    /\.sentinel-activity-list\s*\{[\s\S]*?margin:\s*0/,
  );
  assert.match(stylesSource, /\.system-activity-row\s*\{[\s\S]*?min-height:\s*60px/);
  assert.match(
    stylesSource,
    /\.sentinel-resume-field > \.native-date-field\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*100%/,
  );
  assert.match(
    stylesSource,
    /\.sentinel-resume-datetime::-webkit-date-and-time-value,[\s\S]*?\.sentinel-resume-datetime::-webkit-datetime-edit\s*\{[\s\S]*?height:\s*46px[\s\S]*?line-height:\s*46px[\s\S]*?text-align:\s*center/,
  );
  assert.match(stylesSource, /input,\nselect\s*\{[\s\S]*?min-height:\s*46px[\s\S]*?padding:\s*0 14px/);
  assert.doesNotMatch(
    stylesSource.match(/\.sentinel-resume-datetime\s*\{([^}]*)\}/)?.[1] ?? "",
    /(?:min-height|padding|border|background)/,
  );
  assert.match(
    sentinelSource,
    /<NativeDateInput\s+id="sentinel-resume-at"\s+className="sentinel-resume-datetime"\s+type="datetime-local"\s+value=\{resumeAt\}/,
  );
});

test("Sentinel cards use the standard System title divider and first-row rhythm", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = {
    request: async (path) => path.includes("wakes")
      ? { success: true, data: { wakes: [] } } as never
      : response({ status: "paused", sentinel: { ...response().data.sentinel, enabled: false } }) as never,
  };

  try {
    root.render(React.createElement(SentinelPageContent, { api }));
    await waitForCondition(
      () => container.textContent?.includes("First wake after resume") === true,
      "paused Sentinel rows",
    );

    for (const selector of [
      '[aria-label="ChatGPT / Claude Message Bridge"]',
      '[aria-labelledby="sentinel-policy-title"]',
      '[aria-label="Sentinel controls"]',
      '[aria-labelledby="sentinel-activity-title"]',
    ]) {
      const card = container.querySelector(selector);
      assert.ok(card, `${selector} is rendered`);
      assert.ok(
        card?.querySelector(selector === '[aria-labelledby="sentinel-activity-title"]'
          ? ".sentinel-activity-empty"
          : ".sentinel-first-row"),
        `${selector} has a first row`,
      );
    }

    assert.match(
      stylesSource,
      /\.sentinel-first-row\s*\{[\s\S]*?min-height:\s*60px[\s\S]*?align-items:\s*center[\s\S]*?border-top:\s*1px solid rgba\(0, 0, 0, 0\.08\)/,
    );
    assert.doesNotMatch(stylesSource, /\.message-bridge-card \.system-note\s*\{[\s\S]*?margin-top:\s*12px/);
    assert.match(stylesSource, /\.message-bridge-card textarea\s*\{[\s\S]*?margin-top:\s*12px/);
    assert.match(stylesSource, /\.sentinel-policy-textarea\s*\{[\s\S]*?margin-top:\s*12px/);
    assert.match(stylesSource, /\.sentinel-resume-field\s*\{[\s\S]*?margin-top:\s*12px/);
    assert.match(stylesSource, /\.sentinel-activity-list\s*\{[\s\S]*?margin:\s*0/);
    assert.doesNotMatch(stylesSource, /\.sentinel-activity-card \.system-empty-state\s*\{[\s\S]*?margin:\s*12px 0 0/);
  } finally {
    root.unmount();
    await waitForPaint();
    env.restore();
  }
});

test("Sentinel field flow uses calculated divider spacing without moving enabled controls", () => {
  assert.match(
    stylesSource,
    /\.message-bridge-card > \.sentinel-first-row\s*\{[\s\S]*?min-height:\s*0[\s\S]*?padding-top:\s*22px/,
  );
  assert.match(
    stylesSource,
    /\.sentinel-policy-card > \.sentinel-first-row,\s*\.sentinel-controls-card > \.sentinel-first-row:not\(\.sentinel-control-row\)\s*\{[\s\S]*?min-height:\s*0[\s\S]*?padding-top:\s*21px/,
  );
  assert.match(
    stylesSource,
    /\.sentinel-first-row\s*\{[\s\S]*?min-height:\s*60px[\s\S]*?align-items:\s*center/,
  );
  assert.doesNotMatch(stylesSource, /\.sentinel-first-row[^}]*align-items:\s*flex-end/);
  assert.match(stylesSource, /\.message-bridge-card textarea\s*\{[\s\S]*?margin-top:\s*12px/);
  assert.match(stylesSource, /\.sentinel-policy-textarea\s*\{[\s\S]*?margin-top:\s*12px/);
  assert.match(stylesSource, /\.sentinel-resume-field\s*\{[\s\S]*?margin-top:\s*12px/);
  assert.match(stylesSource, /\.sentinel-controls-card > \.sentinel-control-row:not\(\.sentinel-first-row\)\s*\{[\s\S]*?margin-top:\s*12px/);
  assert.match(
    sentinelSource,
    /<div className="sentinel-first-row sentinel-control-row">[\s\S]*Wake now[\s\S]*Pause/,
  );
});

test("Sentinel page renders the Message Bridge between status and wake policy", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = {
    request: async (path) => {
      if (path === "/sentinel/wakes?limit=20") {
        return {
          success: true,
          data: {
            wakes: [
              { id: "wake-1", cause: "scheduled", state: "finalized", decision: "quiet", scheduledFor: "2026-08-30T02:15:00.000Z", nextWakeAt: "2026-08-30T04:30:00.000Z", finalizedAt: "2026-08-30T02:15:04.000Z", createdAt: "2026-08-30T02:15:00.000Z", recoveryRequired: false },
            ],
          },
        };
      }
      return response() as never;
    },
  };

  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForPaint();

  assert.match(container.textContent ?? "", /Sentinel/);
  assert.doesNotMatch(container.textContent ?? "", /Autonomous Wake|\bControl\b/);
  assert.match(container.textContent ?? "", /ON/);
  assert.match(container.textContent ?? "", /Next wake/);
  assert.match(container.textContent ?? "", /Last valid wake/);
  assert.match(container.textContent ?? "", /Sleeping/);
  assert.match(container.textContent ?? "", /Wake now/);
  assert.match(container.textContent ?? "", /Pause/);
  assert.match(container.textContent ?? "", /Keep a gentle eye/);
  assert.match(container.textContent ?? "", /Wake Activity/);
  assert.match(container.textContent ?? "", /Message Bridge/);
  assert.doesNotMatch(container.textContent ?? "", /processing_state|delivery_unknown|bridge_event_id|chat composer|transcript/i);
  const sections = [...container.querySelectorAll("section")];
  const status = container.querySelector('[aria-labelledby="sentinel-status-title"]');
  const bridge = container.querySelector('[aria-label="ChatGPT / Claude Message Bridge"]');
  const policy = container.querySelector('[aria-labelledby="sentinel-policy-title"]');
  assert.ok(status);
  assert.ok(bridge);
  assert.ok(policy);
  assert.ok(sections.indexOf(status) < sections.indexOf(bridge));
  assert.ok(sections.indexOf(bridge) < sections.indexOf(policy));
  assert.equal(container.querySelectorAll("textarea")[1]?.value, "Keep a gentle eye on my workspace.");

  root.unmount();
  env.restore();
});

test("Sentinel recovery control appears only for recovery-required projection", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = {
    request: async () => response({ status: "recovery_required" }) as never,
  };
  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForCondition(() => container.textContent?.includes("Wake now") === true, "initial Sentinel readback");
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Recovery")));
  root.unmount();
  env.restore();
});

test("Sentinel renders every projected state with user-facing labels", async () => {
  const projections = [
    ["paused", "Paused", false],
    ["processing", "Processing", true],
    ["waiting_for_chatgpt", "Waiting for ChatGPT / Claude", true],
    ["sleeping", "Sleeping", true],
    ["waking", "Waking", true],
    ["recovery_required", "Recovery required", true],
  ] as const;
  for (const [status, label, enabled] of projections) {
    const env = installDom();
    const container = env.dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    const api: WebApiClient = {
      request: async (path) => path.includes("wakes")
        ? { success: true, data: { wakes: [] } } as never
        : response({ status, sentinel: { ...response().data.sentinel, enabled } }) as never,
    };
    root.render(React.createElement(SentinelPageContent, { api }));
    await waitForCondition(() => container.textContent?.includes(label) === true, `${status} projection`);
    assert.match(container.textContent ?? "", new RegExp(label));
    if (status !== "recovery_required") {
      assert.equal([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Recovery")), false);
    }
    root.unmount();
    await waitForPaint();
    env.restore();
  }
});

test("Sentinel API failures remain visible and do not fabricate an enabled state", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = {
    request: async () => { throw new Error("private provider failure"); },
  };
  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForCondition(() => container.querySelector('[role="alert"]') !== null, "Sentinel error state");
  assert.match(container.textContent ?? "", /temporarily unavailable/);
  assert.doesNotMatch(container.textContent ?? "", /\bON\b/);
  assert.ok(container.querySelector(".system-state-message"));
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("an uninitialized Sentinel requires policy setup before wake controls become available", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let saved = false;
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    request: async (path, init) => {
      requests.push({ path, init });
      if (path === "/sentinel/wakes?limit=20") return { success: true, data: { wakes: [] } } as never;
      if (path === "/sentinel" && init?.method === "PUT") {
        saved = true;
        return { success: true, data: { sentinel: { ...response().data.sentinel, enabled: false } } } as never;
      }
      if (path === "/sentinel" && !saved) {
        throw new WebApiError(404, "SENTINEL_NOT_FOUND", "Sentinel was not found.");
      }
      return response({
        sentinel: { ...response().data.sentinel, enabled: false },
        status: "paused",
      }) as never;
    },
  };

  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForCondition(() => container.textContent?.includes("Set up Sentinel") === true, "uninitialized Sentinel setup state");
  assert.match(container.textContent ?? "", /Save a policy to set up your private wake controls/);
  assert.equal(container.querySelector('input[placeholder="Asia/Shanghai"]'), null);
  assert.equal(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled, false);
  assert.equal([...container.querySelectorAll("button")].some((button) => /^(Resume|Resume now|Wake now|Pause|Recovery)$/.test(button.textContent ?? "")), false);
  assert.doesNotMatch(container.textContent ?? "", /\bON\b/);
  const setup = container.querySelector('[aria-labelledby="sentinel-setup-title"]');
  const bridge = container.querySelector('[aria-label="ChatGPT / Claude Message Bridge"]');
  const policyCard = container.querySelector('[aria-labelledby="sentinel-policy-title"]');
  assert.ok(setup);
  assert.ok(bridge);
  assert.ok(policyCard);
  const sections = [...container.querySelectorAll("section")];
  assert.ok(sections.indexOf(setup) < sections.indexOf(bridge));
  assert.ok(sections.indexOf(bridge) < sections.indexOf(policyCard));

  const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save policy");
  assert.ok(save);
  save.click();
  await waitForCondition(() => container.textContent?.includes("Paused") === true, "persisted paused readback");
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent === "Resume"));
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent === "Resume now"));
  assert.ok(requests.some(({ path, init }) => path === "/sentinel" && init?.method === "PUT"));
  assert.ok(requests.filter(({ path }) => path === "/sentinel").length >= 3);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Sentinel controls refresh authoritative state after mutation", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let enabled = true;
  const paths: string[] = [];
  const api: WebApiClient = {
    request: async (path, init) => {
      paths.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/sentinel/wakes?limit=20") return { success: true, data: { wakes: [] } } as never;
      if (init?.method === "POST" && path === "/sentinel/pause") enabled = false;
      return response({
        sentinel: { ...response().data.sentinel, enabled },
        status: enabled ? "sleeping" : "paused",
      }) as never;
    },
  };
  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForPaint();
  const pause = [...container.querySelectorAll("button")].find((button) => button.textContent === "Pause");
  assert.ok(pause);
  pause?.click();
  await waitForCondition(() => container.textContent?.includes("Paused") === true, "authoritative paused readback");
  await waitForCondition(() => container.querySelector(".sentinel-page")?.getAttribute("aria-busy") === "false", "pause action completion");
  assert.match(container.textContent ?? "", /Paused/);
  assert.ok(paths.includes("POST /sentinel/pause"));
  assert.ok(paths.filter((path) => path === "GET /sentinel").length >= 2);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Sentinel policy draft is sent through the authenticated API contract", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    request: async (path, init) => {
      requests.push({ path, init });
      if (path === "/sentinel/wakes?limit=20") return { success: true, data: { wakes: [] } } as never;
      return response() as never;
    },
  };
  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForCondition(() => container.textContent?.includes("Wake now") === true, "initial Sentinel readback");
  const policy = [...container.querySelectorAll<HTMLTextAreaElement>("textarea")]
    .find((textarea) => textarea.value === "Keep a gentle eye on my workspace.");
  assert.ok(policy);
  assert.equal(policy.value, "Keep a gentle eye on my workspace.");
  [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Save policy")
    ?.click();
  await waitForCondition(() => requests.some(({ path, init }) => path === "/sentinel" && init?.method === "PUT"), "policy save request");
  const save = requests.find(({ path, init }) => path === "/sentinel" && init?.method === "PUT");
  assert.deepEqual(JSON.parse(String(save?.init?.body)), {
    timezone: "Asia/Shanghai",
    policyPrompt: "Keep a gentle eye on my workspace.",
  });
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Sentinel route and navigation entry are wired", () => {
  const appSource = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
  const navSource = readFileSync(new URL("../web/src/layout/NavigationGroups.tsx", import.meta.url), "utf8");
  assert.match(appSource, /path="sentinel"/);
  assert.match(navSource, /to:\s*["']\/sentinel["']/);
  const coreEntries = NAV_GROUPS.find((group) => group.label === "Core")?.entries ?? [];
  const systemEntries = NAV_GROUPS.find((group) => group.label === "System")?.entries ?? [];
  assert.ok(coreEntries.some((entry) => entry.label === "Sentinel" && entry.to === "/sentinel"));
  assert.equal(coreEntries.some((entry) => entry.label === "Autonomous Wake"), false);
  assert.ok(systemEntries.some((entry) => entry.label === "Connections" && entry.to === "/system/connections"));
});

test("Sentinel uses the shared system card order with paused controls contained in one card", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = {
    request: async (path) => path.includes("wakes")
      ? { success: true, data: { wakes: [] } } as never
      : response({
        status: "paused",
        sentinel: { ...response().data.sentinel, enabled: false },
      }) as never,
  };

  try {
    root.render(React.createElement(SentinelPageContent, { api }));
    await waitForCondition(() => container.textContent?.includes("First wake after resume") === true, "paused Sentinel controls");
    assert.ok(container.querySelector(".system-page.sentinel-page"));
    const status = container.querySelector('[aria-labelledby="sentinel-status-title"]');
    const bridge = container.querySelector('[aria-label="ChatGPT / Claude Message Bridge"]');
    const policy = container.querySelector('[aria-labelledby="sentinel-policy-title"]');
    const controls = container.querySelector('[aria-label="Sentinel controls"]');
    const activity = container.querySelector('[aria-labelledby="sentinel-activity-title"]');
    for (const section of [status, bridge, policy, controls, activity]) {
      assert.ok(section?.classList.contains("system-section"));
    }
    const sections = [...container.querySelectorAll("section")];
    assert.ok(sections.indexOf(status!) < sections.indexOf(bridge!));
    assert.ok(sections.indexOf(bridge!) < sections.indexOf(policy!));
    assert.ok(sections.indexOf(policy!) < sections.indexOf(controls!));
    assert.ok(sections.indexOf(controls!) < sections.indexOf(activity!));
    assert.match(controls?.textContent ?? "", /First wake after resume/);
  } finally {
    root.unmount();
    await waitForPaint();
    env.restore();
  }
});

test("Sentinel host-facing copy names ChatGPT and Claude together", () => {
  assert.match(sentinelSource, /Control autonomous wakes and message ChatGPT \/ Claude\./);
  assert.match(sentinelSource, /Waiting for ChatGPT \/ Claude/);
  assert.match(bridgeSource, /aria-label="ChatGPT \/ Claude Message Bridge"/);
  assert.match(bridgeSource, /connected ChatGPT \/ Claude conversation/);
  assert.match(bridgeSource, /Sent to ChatGPT \/ Claude/);
  assert.doesNotMatch(
    bridgeSource,
    /connected ChatGPT conversation|Sent to ChatGPT"/,
  );
});


test("Sentinel loading and unavailable cards share the same titleless state-card structure", () => {
  assert.match(sentinelSource, /function SentinelCardState/);
  assert.match(sentinelSource, /function SentinelStateCard/);
  assert.match(
    sentinelSource,
    /<section className="system-section sentinel-state-card" aria-label=\{label\}>[\s\S]*?<SentinelCardState state=\{state\} message=\{message\} onRetry=\{onRetry\} \/>/,
  );
  assert.match(sentinelSource, /<SentinelStateCard label="Wake policy" state="loading" message="Reading\.\.\." \/>/);
  assert.match(sentinelSource, /label="Wake policy"[\s\S]*?message="Unable to read wake policy\."/);
  assert.match(stylesSource, /\.sentinel-card-state__action-row\s*\{[^}]*min-height:\s*1\.4em[^}]*place-items:\s*center/s);
});
