import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act, useEffect, useRef, useState } from "../web/node_modules/react/index.js";
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
import { RouteScrollManager } from "../web/src/layout/RouteScrollManager..js";

type TestWindow = Window & {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
};

function installDom(url: string) {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url },
  );
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key as keyof Window],
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
      for (const key of ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

async function waitForCondition(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function renderAndWait(path: string) {
  let root!: ReturnType<typeof createRoot>;
  await act(async () => {
    root = renderRoutes(path);
  });
  await waitForCondition(
    () => document.getElementById("navigate") !== null,
    "route content to mount",
  );
  return root;
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
          path: "/day-space",
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
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    root = await renderAndWait("/diary");
    assert.deepEqual(scrolls, []);
    await act(async () => (document.getElementById("navigate") as HTMLButtonElement).click());
    await waitForCondition(() => scrolls.length === 1, "top-level scroll reset");
    assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: "auto" }]);
  } finally {
    await act(async () => root?.unmount());
    env.restore();
  }
});

test("top-level Memory to Diary PUSH resets the window scroll position", async () => {
  const env = installDom("https://leilei.test/memory");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    root = await renderAndWait("/diary");
    await act(async () => (document.getElementById("navigate") as HTMLButtonElement).click());
    await waitForCondition(() => scrolls.length === 1, "top-level scroll reset");
    assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: "auto" }]);
  } finally {
    await act(async () => root?.unmount());
    env.restore();
  }
});

test("top-level Memory to Day Space PUSH resets the window scroll position", async () => {
  const env = installDom("https://leilei.test/memory");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    root = await renderAndWait("/day-space");
    await act(async () => (document.getElementById("navigate") as HTMLButtonElement).click());
    await waitForCondition(() => scrolls.length === 1, "top-level scroll reset");
    assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: "auto" }]);
  } finally {
    await act(async () => root?.unmount());
    env.restore();
  }
});

test("navigateWithinApp preserves state, resets once, and consumes only its marker", async () => {
  const env = installDom("https://leilei.test/");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    root = await renderAndWait("/task");
    await act(async () => {
      navigateWithinApp("/task", {
        globalSearch: { version: 1 },
        quickCreate: "task",
        preserved: true,
      });
      assert.equal((env.dom.window.history.state as Record<string, unknown>)[ROUTE_SCROLL_STATE_KEY] !== undefined, true);
      assert.equal((env.dom.window.history.state as Record<string, unknown>).quickCreate, "task");
      assert.deepEqual((env.dom.window.history.state as Record<string, unknown>).globalSearch, { version: 1 });
    });
    await waitForCondition(() => scrolls.length === 1, "marker-driven scroll reset");
    assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: "auto" }]);
    assert.equal((env.dom.window.history.state as Record<string, unknown>)[ROUTE_SCROLL_STATE_KEY], undefined);
    assert.equal((env.dom.window.history.state as Record<string, unknown>).quickCreate, "task");
    assert.equal((env.dom.window.history.state as Record<string, unknown>).preserved, true);
  } finally {
    await act(async () => root?.unmount());
    env.restore();
  }
});

test("POP and initial mount do not perform a global scroll reset", async () => {
  const env = installDom("https://leilei.test/memory");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    root = await renderAndWait("/diary");
    await act(async () => {
      env.dom.window.history.pushState(null, "", "/diary");
      env.dom.window.dispatchEvent(new env.dom.window.PopStateEvent("popstate"));
    });
    assert.deepEqual(scrolls, []);
  } finally {
    await act(async () => root?.unmount());
    env.restore();
  }
});

test("same-path query navigation does not perform a global scroll reset", async () => {
  const env = installDom("https://leilei.test/memory");
  const scrolls: unknown[] = [];
  env.dom.window.scrollTo = ((options: unknown) => scrolls.push(options)) as typeof window.scrollTo;
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    root = await renderAndWait("/memory?q=goal");
    await act(async () => (document.getElementById("navigate") as HTMLButtonElement).click());
    assert.deepEqual(scrolls, []);
  } finally {
    await act(async () => root?.unmount());
    env.restore();
  }
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
  try {
    await act(async () => root.render(React.createElement(BrowserRouter, null,
      React.createElement(RouteScrollManager),
      React.createElement(Routes, null,
        React.createElement(Route, { path: "/", element: React.createElement("button", { id: "quick", onClick: () => navigateWithinApp("/task", { quickCreate: "task" }) }, "quick") }),
        React.createElement(Route, { path: "/task", element: React.createElement(FocusTarget) }),
      ),
    )));
    await waitForCondition(
      () => document.getElementById("quick") !== null,
      "quick-create trigger to mount",
    );
    await act(async () => (document.getElementById("quick") as HTMLButtonElement).click());
    await waitForCondition(() => events.length === 2, "quick-create scroll and focus");
    assert.deepEqual(events, ["scroll", "focus"]);
  } finally {
    await act(async () => root.unmount());
    env.restore();
  }
});
