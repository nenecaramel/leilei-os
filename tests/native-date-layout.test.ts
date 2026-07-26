import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { NativeDateInput } from "../web/src/components/NativeDateInput.js";

const webRequire = createRequire(
  new URL("../web/package.json", import.meta.url),
);
const { createElement } = webRequire("react") as {
  createElement: (...args: unknown[]) => unknown;
};
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  renderToStaticMarkup: (node: unknown) => string;
};

const shouldRunSafariLayoutTest =
  process.env.RUN_SAFARI_LAYOUT_TEST === "1";
const safariDriverUrl =
  process.env.SAFARI_WEBDRIVER_URL ?? "http://127.0.0.1:4444";
const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);
const taskPageSource = readFileSync(
  new URL("../web/src/pages/TaskPage.tsx", import.meta.url),
  "utf8",
);
const diaryPageSource = readFileSync(
  new URL("../web/src/pages/DiaryPage.tsx", import.meta.url),
  "utf8",
);

type WebDriverResponse<T> = {
  value: T;
};

type WebDriverSession = {
  sessionId: string;
};

type ControlBounds = {
  name: string;
  left: number;
  right: number;
  cardContentLeft: number;
  cardContentRight: number;
};

type LayoutBounds = {
  controls: ControlBounds[];
  clientWidth: number;
  scrollWidth: number;
};

async function webdriver<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${safariDriverUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Safari WebDriver request failed (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json() as WebDriverResponse<T>).value;
}

function createLayoutFixture(): string {
  const controls = renderToStaticMarkup(
    createElement(
      "main",
      { className: "page memory-page", "data-layout-page": true },
      createElement(
        "section",
        { className: "memory-message", "data-form-card": "task" },
        createElement("h2", null, "Task"),
        createElement("input", {
          type: "text",
          "data-control": "task-text",
          value: "Task title",
          readOnly: true,
        }),
        createElement(NativeDateInput, {
          type: "datetime-local",
          "data-control": "task-datetime",
          value: "2026-07-26T10:30",
          readOnly: true,
        }),
        createElement(NativeDateInput, {
          type: "time",
          "data-control": "task-time",
          value: "10:30",
          readOnly: true,
        }),
      ),
      createElement(
        "section",
        { className: "memory-message", "data-form-card": "diary" },
        createElement("h2", null, "Diary"),
        createElement("input", {
          type: "text",
          "data-control": "diary-text",
          value: "Diary title",
          readOnly: true,
        }),
        createElement(NativeDateInput, {
          type: "date",
          "data-control": "diary-date",
          value: "2026-07-26",
          readOnly: true,
        }),
      ),
      createElement(
        "section",
        {
          className: "memory-message diary-filters",
          "data-form-card": "diary-filters",
        },
        createElement("h2", null, "Diary filters"),
        createElement("input", {
          type: "text",
          "data-control": "diary-filter-query",
          value: "Long diary search filter",
          readOnly: true,
        }),
        createElement(
          "label",
          null,
          createElement("span", null, "开始日期"),
          createElement(NativeDateInput, {
            type: "date",
            "data-control": "diary-filter-from",
            value: "2026-07-01",
            readOnly: true,
          }),
        ),
        createElement(
          "label",
          null,
          createElement("span", null, "结束日期"),
          createElement(NativeDateInput, {
            type: "date",
            "data-control": "diary-filter-to",
            value: "2026-07-31",
            readOnly: true,
          }),
        ),
      ),
    ),
  );

  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head>
<body>${controls}</body></html>`;
}

async function measureLayout(
  sessionId: string,
  width: number,
  height: number,
): Promise<LayoutBounds> {
  await webdriver(`/session/${sessionId}/window/rect`, "POST", {
    width,
    height,
    x: 0,
    y: 0,
  });
  await webdriver(`/session/${sessionId}/url`, "POST", {
    url: `data:text/html;charset=utf-8,${encodeURIComponent(createLayoutFixture())}`,
  });

  return webdriver<LayoutBounds>(`/session/${sessionId}/execute/sync`, "POST", {
    script: `
      const controls = [...document.querySelectorAll('[data-control]')];
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controls: controls.map((control) => {
          const input = control;
          const card = input.closest('[data-form-card]');
          const inputRect = input.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          const cardStyle = getComputedStyle(card);
          return {
            name: input.dataset.control,
            left: inputRect.left,
            right: inputRect.right,
            cardContentLeft: cardRect.left + parseFloat(cardStyle.paddingLeft),
            cardContentRight: cardRect.right - parseFloat(cardStyle.paddingRight),
          };
        }),
      };
    `,
    args: [],
  });
}

test("Task and Diary route date fields share NativeDateInput", () => {
  assert.match(taskPageSource, /import \{ NativeDateInput \}/);
  assert.match(taskPageSource, /<NativeDateInput[\s\S]*?type="datetime-local"/);
  assert.match(diaryPageSource, /import \{ NativeDateInput \}/);
  assert.match(diaryPageSource, /<NativeDateInput[\s\S]*?type="date"/);
});

test(
  "native date fields stay inside their real form cards in Safari WebKit",
  { skip: !shouldRunSafariLayoutTest },
  async () => {
    await webdriver("/status", "GET");
    const session = await webdriver<WebDriverSession>("/session", "POST", {
      capabilities: {
        alwaysMatch: {
          browserName: "safari",
        },
      },
    });

    try {
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        const layout = await measureLayout(
          session.sessionId,
          viewport.width,
          viewport.height,
        );

        assert.ok(layout.scrollWidth <= layout.clientWidth);

        for (const control of layout.controls) {
          assert.ok(
            control.left >= control.cardContentLeft,
            `${viewport.width}px ${control.name} starts outside its card`,
          );
          assert.ok(
            control.right <= control.cardContentRight,
            `${viewport.width}px ${control.name} ends outside its card`,
          );
        }
      }
    } finally {
      await webdriver(`/session/${session.sessionId}`, "DELETE");
    }
  },
);
