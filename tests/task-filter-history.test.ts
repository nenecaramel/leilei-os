import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  createTaskFilterHistorySnapshot,
  createTaskSearchDebouncer,
  pushTaskFilterHistory,
  subscribeToTaskFilterHistory,
} from "../web/src/pages/task-filter-history.js";
import {
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

  await navigateHistory(window, () => window.history.forward());
  assert.equal(filters(window).status, "completed");
  assert.equal(visibleResult, "completed");
  unsubscribe();
});

test("tag and custom date changes each create restorable history entries", async () => {
  const window = createWindow("/task?tag=before");
  const withTag = {
    ...filters(window),
    tag: "after",
  };
  const withDate: TaskFilters = {
    ...withTag,
    due: "custom",
    dueFrom: "2026-07-26T00:00:00.000Z",
    dueTo: "2026-07-27T00:00:00.000Z",
  };

  pushTaskFilterHistory(window, withTag);
  pushTaskFilterHistory(window, withDate);

  assert.equal(filters(window).due, "custom");
  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).tag, "after");
  assert.equal(filters(window).due, "");
  await navigateHistory(window, () => window.history.back());
  assert.equal(filters(window).tag, "before");
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
  const debouncer = createTaskSearchDebouncer({
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

test("the same committed filter URL is not pushed twice", () => {
  const window = createWindow("/task?status=pending");
  const initialLength = window.history.length;

  const pushed = pushTaskFilterHistory(window, {
    ...EMPTY_TASK_FILTERS,
    status: "pending",
  });

  assert.equal(pushed, false);
  assert.equal(window.history.length, initialLength);
});

test("preset date boundaries remain stable in a history snapshot", () => {
  const snapshot = createTaskFilterHistorySnapshot({
    ...EMPTY_TASK_FILTERS,
    due: "next_7_days",
  });
  const firstRequest = createTaskFilterHistorySnapshot(snapshot);

  assert.match(snapshot.dueFrom, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(snapshot.dueTo, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(firstRequest, snapshot);
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
