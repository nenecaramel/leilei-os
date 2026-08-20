import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { useEffect, useRef, useState } from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import {
  BrowserRouter,
  Route,
  Routes,
  useNavigate,
} from "../web/node_modules/react-router-dom/dist/index.mjs";
import {
  navigateWithinApp,
  ROUTE_SCROLL_STATE_KEY,
} from "../web/src/pages/app-navigation.js";
import { RouteScrollManager } from "../web/src/layout/RouteScrollManager.js";

type TestWindow = Window & {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
};

function installDom(url: string) {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url },
  );
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key as keyof Window],
    });
  }
  const testWindow = dom.window as unknown as TestWindow;
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value: () => {},
  });
  testWindow.requestAnimationFrame = (callback) => {
    callback(0);
    return 1;
  };
  return {
    dom,
    restore() {
      for (const key of ["window", "document", "navigator"]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

function waitForEffects() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function NavigationButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return React.createElement(
    "button",
    { id: "navigate", onClick: () => navigate(to) },
    "navigate",
  );
}

function renderRoutes(path: string) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  root.render(
    React.createElement(
      BrowserRouter,
      null,
      React.createElement(RouteScrollManager),
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/",
          element: React.createElement(NavigationButton, { to: "/memory" }),
        }),
        React.createElement(Route, {
          path: "/memory",
          element: React.createElement(NavigationButton, { to: path }),
        }),
        React.createElement(Route, {
          path: "/diary",
          element: React.createElement(NavigationButton, { to: "/task" }),
        }),
        React.createElement(Route, {
          path: "/task",
          element: React.createElement(NavigationButton, { to: "/task" }),
        }),
      ),
    ),
  );
  return root;
}

test("top-level Dashboard to Memory PUSH resets the window scroll position", async () => {
  const env = installDom("https://leilei.test/");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  const root = renderRoutes("/diary");
  await waitForEffects();
  assert.deepEqual(scrolls, []);
  (document.getElementById("navigate") as HTMLButtonElement).click();
  await waitForEffects();
  assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: "auto" }]);
  root.unmount();
  env.restore();
});

test("top-level Memory to Diary PUSH resets the window scroll position", async () => {
  const env = installDom("https://leilei.test/memory");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  const root = renderRoutes("/diary");
  await waitForEffects();
  (document.getElementById("navigate") as HTMLButtonElement).click();
  await waitForEffects();
  assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: "auto" }]);
  root.unmount();
  env.restore();
});

test("top-level Memory to Day Space PUSH resets the window scroll position", async () => {
  const env = installDom("https://leilei.test/memory");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  const root = renderRoutes("/day-space");
  await waitForEffects();
  (document.getElementById("navigate") as HTMLButtonElement).click();
  await waitForEffects();
  assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: "auto" }]);
  root.unmount();
  env.restore();
});

test("navigateWithinApp preserves state, resets once, and consumes only its marker", async () => {
  const env = installDom("https://leilei.test/");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  const root = renderRoutes("/task");
  await waitForEffects();
  navigateWithinApp("/task", {
    globalSearch: { version: 1 },
    quickCreate: "task",
    preserved: true,
  });
  assert.equal((env.dom.window.history.state as Record<string, unknown>)[ROUTE_SCROLL_STATE_KEY] !== undefined, true);
  assert.equal((env.dom.window.history.state as Record<string, unknown>).quickCreate, "task");
  assert.deepEqual((env.dom.window.history.state as Record<string, unknown>).globalSearch, { version: 1 });
  await waitForEffects();
  assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: "auto" }]);
  assert.equal((env.dom.window.history.state as Record<string, unknown>)[ROUTE_SCROLL_STATE_KEY], undefined);
  assert.equal((env.dom.window.history.state as Record<string, unknown>).quickCreate, "task");
  assert.equal((env.dom.window.history.state as Record<string, unknown>).preserved, true);
  root.unmount();
  env.restore();
});

test("POP and initial mount do not perform a global scroll reset", async () => {
  const env = installDom("https://leilei.test/memory");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  const root = renderRoutes("/diary");
  await waitForEffects();
  env.dom.window.history.pushState(null, "", "/diary");
  env.dom.window.dispatchEvent(new env.dom.window.PopStateEvent("popstate"));
  await waitForEffects();
  assert.deepEqual(scrolls, []);
  root.unmount();
  env.restore();
});

test("same-path query navigation does not perform a global scroll reset", async () => {
  const env = installDom("https://leilei.test/memory");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  const root = renderRoutes("/memory?q=goal");
  await waitForEffects();
  (document.getElementById("navigate") as HTMLButtonElement).click();
  await waitForEffects();
  assert.deepEqual(scrolls, []);
  root.unmount();
  env.restore();
});

test("quick-create focus runs after the route scroll reset", async () => {
  const env = installDom("https://leilei.test/");
  const events: string[] = [];
  env.dom.window.scrollTo = (() => events.push("scroll")) as typeof window.scrollTo;
  const FocusTarget = () => {
    const [show, setShow] = useState(false);
    const input = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      if ((window.history.state as Record<string, unknown> | null)?.quickCreate === "task") setShow(true);
    }, []);
    useEffect(() => {
      if (!show) return;
      window.requestAnimationFrame(() => {
        events.push("focus");
        input.current?.focus();
      });
    }, [show]);
    return show ? React.createElement("input", { ref: input }) : null;
  };
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null,
    React.createElement(RouteScrollManager),
    React.createElement(Routes, null,
      React.createElement(Route, { path: "/", element: React.createElement("button", { id: "quick", onClick: () => navigateWithinApp("/task", { quickCreate: "task" }) }, "quick") }),
      React.createElement(Route, { path: "/task", element: React.createElement(FocusTarget) }),
    ),
  ));
  await waitForEffects();
  (document.getElementById("quick") as HTMLButtonElement).click();
  await waitForEffects();
  assert.deepEqual(events, ["scroll", "focus"]);
  root.unmount();
  await waitForEffects();
  env.restore();
});
