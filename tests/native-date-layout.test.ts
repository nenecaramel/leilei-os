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
const indexHtml = readFileSync(
  new URL("../web/index.html", import.meta.url),
  "utf8",
);
const diaryPageSource = readFileSync(
  new URL("../web/src/pages/DiaryPage.tsx", import.meta.url),
  "utf8",
);
const diaryPageHeaderSource = readFileSync(
  new URL("../web/src/pages/DiaryPageHeader.tsx", import.meta.url),
  "utf8",
);
const globalSearchPageSource = readFileSync(
  new URL("../web/src/pages/GlobalSearchPage.tsx", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(
  new URL("../web/src/layout/AppShell.tsx", import.meta.url),
  "utf8",
);
const navigationSource = readFileSync(
  new URL("../web/src/layout/NavigationGroups.tsx", import.meta.url),
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
  sidebar: {
    avatarBackgroundColor: string;
    avatarBorderColor: string;
    avatarBorderStyle: string;
    avatarBorderWidth: string;
    brandBackgroundColor: string;
    footerDisplay: string;
  };
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
      "div",
      { className: "app-shell" },
      createElement(
        "aside",
        { className: "sidebar" },
        createElement(
          "div",
          { className: "sidebar-brand" },
          createElement("div", {
            className: "brand-mark",
            "data-brand-mark": true,
          }, "L"),
        ),
        createElement(
          "nav",
          { className: "primary-nav" },
          createElement("a", { className: "nav-item" }, "Dashboard"),
        ),
        createElement(
          "div",
          { className: "sidebar-footer", "data-sidebar-footer": true },
          createElement("div", {
            className: "user-avatar",
            "data-sidebar-avatar": true,
          }, "LL"),
        ),
      ),
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
      const avatar = document.querySelector('[data-sidebar-avatar]');
      const footer = document.querySelector('[data-sidebar-footer]');
      const brand = document.querySelector('[data-brand-mark]');
      const avatarStyle = getComputedStyle(avatar);
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        sidebar: {
          avatarBackgroundColor: avatarStyle.backgroundColor,
          avatarBorderColor: avatarStyle.borderColor,
          avatarBorderStyle: avatarStyle.borderStyle,
          avatarBorderWidth: avatarStyle.borderWidth,
          brandBackgroundColor: getComputedStyle(brand).backgroundColor,
          footerDisplay: getComputedStyle(footer).display,
        },
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

test("Diary route date fields share NativeDateInput", () => {
  assert.match(diaryPageHeaderSource, /<ModulePageHeader/);
  // f1fa4659 extracted the real date controls into the shared header.
  const header = readFileSync("web/src/pages/ModulePageHeader.tsx", "utf8");
  assert.match(header, /import \{ NativeDateInput \}/);
  assert.equal([...header.matchAll(/<NativeDateInput[\s\S]*?type="date"/g)].length, 2);
});

test("Global Search date fields share NativeDateInput and its constrained class", () => {
  assert.match(globalSearchPageSource, /import \{ NativeDateInput \}/);
  assert.match(globalSearchPageSource, /<NativeDateInput[\s\S]*?id="global-search-date-from"[\s\S]*?type="date"/);
  assert.match(globalSearchPageSource, /<NativeDateInput[\s\S]*?id="global-search-date-to"[\s\S]*?type="date"/);
  const markup = renderToStaticMarkup(createElement(NativeDateInput, { type: "date", id: "global-search-date-from" }));
  assert.match(markup, /class="native-date-field"/);
  assert.match(markup, /class="native-date-input"/);
  assert.match(styles, /\.global-search-filters > \.native-date-field/);
});

test("Web shell reserves the iPhone safe area and preloads route-aware theme colors", () => {
  assert.match(indexHtml, /viewport-fit=cover/);
  assert.match(
    indexHtml,
    /<meta id="theme-color" name="theme-color" content="#ebeae4" \/>/,
  );
  assert.match(
    indexHtml,
    /window\.location\.pathname === "\/universe"[\s\S]*themeColor\.content = "#0b0c12"/,
  );
  assert.doesNotMatch(
    indexHtml,
    /leilei-os\.settings\.v1|leilei-os\.theme\.v1|--theme-page-background/,
  );
  assert.match(styles, /env\(safe-area-inset-top, 0px\)/);
  assert.match(styles, /html,[\s\S]*body,[\s\S]*#root/);
});

test("grouped navigation keeps every entry reachable in the mobile drawer", () => {
  assert.match(navigationSource, /label: "Account"/);
  assert.match(navigationSource, /label: "Status"/);
  assert.match(navigationSource, /label: "Data"/);
  assert.doesNotMatch(navigationSource, /label: "Activity"/);
  assert.match(navigationSource, /label: "About"/);
  assert.match(navigationSource, /label: "Home"/);
  assert.match(navigationSource, /label: "Global Search"/);
  assert.match(navigationSource, /label: "Settings"/);
  assert.match(navigationSource, /label: "Day Space"[\s\S]{0,160}?to: "\/day-space"/);
  assert.doesNotMatch(navigationSource, /General|Appearance|Data & Backup|includeSecondarySystemItems/);
  assert.match(styles, /\.mobile-drawer-panel\s*\{[\s\S]*?width:\s*min\(82vw,\s*280px\)/);
  assert.match(styles, /\.mobile-drawer-panel\s*\{[\s\S]*?padding:\s*calc\(env\(safe-area-inset-top,\s*0px\) \+ 8px\)[\s\S]*?max\(18px,\s*env\(safe-area-inset-bottom,\s*0px\)\)/);
  assert.match(styles, /\.mobile-drawer-panel\s*\{[\s\S]*?env\(safe-area-inset-bottom/);
  assert.match(styles, /\.mobile-drawer \.nav-item\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /\.mobile-drawer\s*\{[\s\S]*?z-index:/);
  assert.doesNotMatch(styles, /body\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(styles, /min-height:\s*100dvh/);
  assert.match(appShellSource, /MobileNavigationDrawer/);
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

        assert.equal(
          layout.sidebar.avatarBackgroundColor,
          "rgb(235, 235, 235)",
        );
        assert.equal(
          layout.sidebar.avatarBorderColor,
          "rgb(217, 217, 217)",
        );
        assert.equal(layout.sidebar.avatarBorderStyle, "solid");
        assert.equal(layout.sidebar.avatarBorderWidth, "1px");
        assert.notEqual(
          layout.sidebar.brandBackgroundColor,
          layout.sidebar.avatarBackgroundColor,
        );
        assert.equal(
          layout.sidebar.footerDisplay,
          viewport.width <= 640 ? "none" : "flex",
        );
      }
    } finally {
      await webdriver(`/session/${session.sessionId}`, "DELETE");
    }
  },
);
