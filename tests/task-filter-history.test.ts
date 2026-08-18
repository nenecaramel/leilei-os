import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  createTaskFilterHistorySnapshot,
  createTaskFilterDebouncer,
  pushTaskFilterHistory,
  readTaskFilterHistorySnapshot,
  subscribeToTaskFilterHistory,
} from "../web/src/pages/task-filter-history.js";
import {
  buildTaskListRequest,
  cancelLatestTaskRequest,
  createLatestTaskRequestTracker,
  settleLatestTaskRequest,
} from "../web/src/pages/task-list-request.js";
import {
  EMPTY_TASK_FILTERS,
  createTaskDetailLocation,
  getTaskDetailLocation,
  readTaskFilters,
  type TaskFilters,
} from "../web/src/pages/task-location.js";

function createWindow(path = "/task") {
  return new JSDOM("", {
    url: `https://leilei-os.test${path}`,
  }).window;
}

async function navigateHistory(
  window: Window,
  navigate: () => void,
): Promise<void> {
  await new Promise<void>((resolve) => {
    window.addEventListener("popstate", () => resolve(), {
      once: true,
    });
    navigate();
  });
}

function filters(window: Window): TaskFilters {
  return readTaskFilters(window.location.search);
}

test("status filter pushes history and back/forward restore controls and results", async () => {
  const window = createWindow("/task?q=特殊字符&status=pending");
  const initialLength = window.history.length;
  let visibleResult = filters(window).status;
  const unsubscribe = subscribeToTaskFilterHistory(window, (restored) => {
    visibleResult = restored.status;
  });

  const pushed = pushTaskFilterHistory(window, {
    ...filters(window),
    status: "completed",
  });

  assert.equal(pushed, true);
  assert.equal(window.history.length, initialLength + 1);
  assert.equal(filters(window).status, "completed");

  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).status, "pending");
  assert.equal(visibleResult, "pending");
  assert.equal(window.history.length, initialLength + 1);

  await navigateHistory(window, () => window.history.forward());
  assert.equal(filters(window).status, "completed");
  assert.equal(visibleResult, "completed");
  assert.equal(window.history.length, initialLength + 1);
  unsubscribe();
});

test("priority, tag, due mode, and each custom date boundary are restorable", async () => {
  const window = createWindow("/task?tag=before");
  const withPriority = {
    ...filters(window),
    priority: "high",
  };
  const withTag = {
    ...withPriority,
    tag: "after",
  };
  const withCustomMode: TaskFilters = {
    ...withTag,
    due: "custom",
    dueFrom: "",
    dueTo: "",
  };
  const withStart: TaskFilters = {
    ...withCustomMode,
    dueFrom: "2026-07-26T00:00:00.000Z",
  };
  const withEnd: TaskFilters = {
    ...withStart,
    dueTo: "2026-07-27T00:00:00.000Z",
  };

  pushTaskFilterHistory(window, withPriority);
  pushTaskFilterHistory(window, withTag);
  pushTaskFilterHistory(window, withCustomMode);
  pushTaskFilterHistory(window, withStart);
  pushTaskFilterHistory(window, withEnd);

  assert.equal(filters(window).due, "custom");
  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).dueFrom, "2026-07-26T00:00:00.000Z");
  assert.equal(filters(window).dueTo, "");
  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).due, "custom");
  assert.equal(filters(window).dueFrom, "");
  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).tag, "after");
  assert.equal(filters(window).due, "");
  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).tag, "before");
  assert.equal(filters(window).priority, "high");
  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).tag, "before");
  assert.equal(filters(window).priority, "");
});

test("clear all is a push that can be undone with browser back", async () => {
  const window = createWindow(
    "/task?q=report&status=pending&priority=high&tag=work",
  );

  pushTaskFilterHistory(window, EMPTY_TASK_FILTERS);
  assert.equal(window.location.search, "");

  await navigateHistory(window, () => window.history.back());
  assert.deepEqual(filters(window), {
    ...EMPTY_TASK_FILTERS,
    q: "report",
    status: "pending",
    priority: "high",
    tag: "work",
  });
});

test("rapid search typing commits only the final query once after debounce", async () => {
  const window = createWindow("/task");
  const initialLength = window.history.length;
  const committedQueries: string[] = [];
  const debouncer = createTaskFilterDebouncer({
    delayMs: 20,
    commit: (query) => {
      committedQueries.push(query);
      pushTaskFilterHistory(window, {
        ...EMPTY_TASK_FILTERS,
        q: query,
      });
    },
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  });

  debouncer.schedule("特");
  debouncer.schedule("特殊");
  debouncer.schedule("特殊字符");
  assert.equal(window.history.length, initialLength);

  await new Promise((resolve) => window.setTimeout(resolve, 40));
  assert.deepEqual(committedQueries, ["特殊字符"]);
  assert.equal(window.history.length, initialLength + 1);
  assert.equal(filters(window).q, "特殊字符");
});

test("clearing a search is one debounced and reversible history operation", async () => {
  const window = createWindow("/task?q=report");
  const initialLength = window.history.length;
  const debouncer = createTaskFilterDebouncer({
    delayMs: 20,
    commit: (query) => {
      pushTaskFilterHistory(window, {
        ...EMPTY_TASK_FILTERS,
        q: query,
      });
    },
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  });

  debouncer.schedule("");
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  assert.equal(window.location.search, "");
  assert.equal(window.history.length, initialLength + 1);

  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).q, "report");
});

test("rapid tag typing commits only the final complete tag once", async () => {
  const window = createWindow("/task");
  const initialLength = window.history.length;
  const committedTags: string[] = [];
  const debouncer = createTaskFilterDebouncer({
    delayMs: 20,
    commit: (tag) => {
      committedTags.push(tag);
      pushTaskFilterHistory(window, {
        ...EMPTY_TASK_FILTERS,
        tag,
      });
    },
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  });

  debouncer.schedule("fil");
  debouncer.schedule("filter");
  debouncer.schedule("filter-test");
  await new Promise((resolve) => window.setTimeout(resolve, 40));

  assert.deepEqual(committedTags, ["filter-test"]);
  assert.equal(window.history.length, initialLength + 1);
  assert.equal(filters(window).tag, "filter-test");

  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).tag, "");
});

test("cancelled filter debounce timers never commit after unmount cleanup", async () => {
  const window = createWindow("/task");
  let commits = 0;
  const debouncer = createTaskFilterDebouncer({
    delayMs: 20,
    commit: () => {
      commits += 1;
    },
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  });

  debouncer.schedule("pending");
  debouncer.cancel();
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  assert.equal(commits, 0);
});

test("the same committed filter URL is not pushed twice", () => {
  const window = createWindow("/task?status=pending&q=report");
  const initialLength = window.history.length;

  const pushed = pushTaskFilterHistory(window, {
    ...EMPTY_TASK_FILTERS,
    q: "report",
    status: "pending",
  });

  assert.equal(pushed, false);
  assert.equal(window.history.length, initialLength);
});

test("a complete history URL contains every normalized request parameter", () => {
  const window = createWindow("/task");
  pushTaskFilterHistory(window, {
    q: "  report  ",
    status: "pending",
    priority: "high",
    tag: "work",
    due: "custom",
    dueFrom: "2026-07-26T08:30",
    dueTo: "2026-07-27T18:45",
  });

  const parameters = new URLSearchParams(window.location.search);
  assert.deepEqual(Object.fromEntries(parameters), {
    q: "report",
    status: "pending",
    priority: "high",
    tag: "work",
    due: "custom",
    due_from: "2026-07-26T08:30",
    due_to: "2026-07-27T18:45",
  });
  assert.equal(buildTaskListRequest(EMPTY_TASK_FILTERS).search, "");
});

test("today and next_7_days delegate account-timezone boundaries to the API", () => {
  for (const due of ["today", "next_7_days"] as const) {
    const snapshot = createTaskFilterHistorySnapshot({
      ...EMPTY_TASK_FILTERS,
      due,
    });
    const firstRequest = buildTaskListRequest(snapshot);
    const restored = readTaskFilterHistorySnapshot(firstRequest.search);
    const restoredRequest = buildTaskListRequest(restored);

    assert.equal(new URLSearchParams(firstRequest.search).has("due_from"), false);
    assert.equal(new URLSearchParams(firstRequest.search).has("due_to"), false);
    assert.equal(restoredRequest.search, firstRequest.search);
  }
});

test("custom date controls preserve account-timezone local values", () => {
  const originalRequest = buildTaskListRequest({
    ...EMPTY_TASK_FILTERS,
    due: "custom",
    dueFrom: "2026-07-26T08:30",
    dueTo: "2026-07-27T18:45",
  });
  const restored = readTaskFilterHistorySnapshot(
    originalRequest.search,
  );

  assert.match(restored.dueFrom, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.match(restored.dueTo, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(
    buildTaskListRequest(restored).search,
    originalRequest.search,
  );
});

test("task detail history and explicit return preserve the safe filtered URL", async () => {
  const listLocation = "/task?q=report&status=pending&tag=work";
  const window = createWindow(listLocation);
  const detailLocation = createTaskDetailLocation(
    "task-123",
    listLocation,
  );

  window.history.pushState(null, "", detailLocation);
  await navigateHistory(window, () => window.history.back());
  assert.equal(
    `${window.location.pathname}${window.location.search}`,
    listLocation,
  );

  const refreshedDetailWindow = createWindow(detailLocation);
  const detail = getTaskDetailLocation(
    refreshedDetailWindow.location.search,
  );
  refreshedDetailWindow.history.pushState(
    null,
    "",
    detail.returnTo,
  );
  assert.equal(
    `${refreshedDetailWindow.location.pathname}${refreshedDetailWindow.location.search}`,
    listLocation,
  );

  const unsafeWindow = createWindow(
    "/task?task=task-123&returnTo=https%3A%2F%2Fevil.test%2F",
  );
  assert.equal(
    getTaskDetailLocation(unsafeWindow.location.search).returnTo,
    "/task",
  );

  for (const unsafeReturnTo of [
    "//example.com/task",
    "/settings",
    "/task?task=nested",
    "/task?returnTo=%2Ftask%3Fq%3Dnested",
  ]) {
    const location = createTaskDetailLocation(
      "task-123",
      unsafeReturnTo,
    );
    const parsed = new URL(location, "https://leilei-os.test");
    assert.equal(
      getTaskDetailLocation(parsed.search).returnTo,
      "/task",
    );
  }
});

test("a request from an older history state cannot overwrite restored results", async () => {
  const window = createWindow("/task?status=pending");
  const tracker = createLatestTaskRequestTracker();
  const oldTicket = tracker.begin();
  const oldController = new AbortController();
  let visibleResult = "pending";

  pushTaskFilterHistory(window, {
    ...filters(window),
    status: "completed",
  });
  tracker.invalidate();
  const currentTicket = tracker.begin();
  visibleResult = "completed";

  await navigateHistory(window, () => window.history.back());
  tracker.invalidate();
  visibleResult = filters(window).status;

  await settleLatestTaskRequest({
    request: Promise.resolve("stale-completed-result"),
    ticket: currentTicket,
    signal: oldController.signal,
    onSuccess: (value) => {
      visibleResult = value;
    },
    onError: () => {
      visibleResult = "error";
    },
  });

  assert.equal(visibleResult, "pending");
  assert.equal(oldTicket.isCurrent(), false);
});

test("history restoration invalidates the old ticket and aborts its request", () => {
  const tracker = createLatestTaskRequestTracker();
  const oldTicket = tracker.begin();
  const controller = new AbortController();

  cancelLatestTaskRequest(tracker, controller);

  assert.equal(oldTicket.isCurrent(), false);
  assert.equal(controller.signal.aborted, true);
});
