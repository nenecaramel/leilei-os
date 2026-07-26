import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTaskListRequest,
  createLatestTaskRequestTracker,
  settleLatestTaskRequest,
} from "../web/src/pages/task-list-request.js";
import {
  EMPTY_TASK_FILTERS,
  type TaskFilters,
} from "../web/src/pages/task-location.js";

test("task tag filter sends only the complete trimmed tag value", () => {
  const request = buildTaskListRequest({
    ...EMPTY_TASK_FILTERS,
    tag: "  filter  ",
  });

  assert.equal(request.url, "/task?tag=filter");
  assert.equal(
    new URLSearchParams(request.search).get("tag"),
    "filter",
  );
  assert.equal(new URLSearchParams(request.search).get("q"), null);
});

test("task list request combines tag with other filters using separate parameters", () => {
  const filters: TaskFilters = {
    ...EMPTY_TASK_FILTERS,
    q: "report",
    status: "pending",
    priority: "high",
    tag: "filter-test",
  };

  const parameters = new URLSearchParams(
    buildTaskListRequest(filters).search,
  );

  assert.deepEqual(
    Object.fromEntries(parameters),
    {
      q: "report",
      status: "pending",
      priority: "high",
      tag: "filter-test",
    },
  );
});

test("older task requests cannot become current after a newer tag request starts", () => {
  const tracker = createLatestTaskRequestTracker();
  const filterTestRequest = tracker.begin();
  const filterRequest = tracker.begin();

  assert.equal(filterTestRequest.isCurrent(), false);
  assert.equal(filterRequest.isCurrent(), true);

  tracker.invalidate();
  assert.equal(filterRequest.isCurrent(), false);
});

test("an older tag response cannot replace the newer request loading state", async () => {
  const tracker = createLatestTaskRequestTracker();
  const oldTicket = tracker.begin();
  const oldController = new AbortController();
  let visibleState = "loading-filter";

  tracker.invalidate();
  const currentTicket = tracker.begin();

  await settleLatestTaskRequest({
    request: Promise.resolve(["filter-test-task"]),
    ticket: oldTicket,
    signal: oldController.signal,
    onSuccess: () => {
      visibleState = "old-results";
    },
    onError: () => {
      visibleState = "old-error";
    },
  });

  assert.equal(visibleState, "loading-filter");
  assert.equal(currentTicket.isCurrent(), true);
});

test("an aborted task request does not surface an error", async () => {
  const tracker = createLatestTaskRequestTracker();
  const ticket = tracker.begin();
  const controller = new AbortController();
  let errorVisible = false;

  controller.abort();
  await settleLatestTaskRequest({
    request: Promise.reject(
      new DOMException("The operation was aborted.", "AbortError"),
    ),
    ticket,
    signal: controller.signal,
    onSuccess: () => {},
    onError: () => {
      errorVisible = true;
    },
  });

  assert.equal(errorVisible, false);
});

test("the latest real task request failure remains visible and retryable", async () => {
  const tracker = createLatestTaskRequestTracker();
  const ticket = tracker.begin();
  const controller = new AbortController();
  let visibleState = "loading";

  await settleLatestTaskRequest({
    request: Promise.reject(new Error("Network unavailable")),
    ticket,
    signal: controller.signal,
    onSuccess: () => {
      visibleState = "ready";
    },
    onError: () => {
      visibleState = "error";
    },
  });

  assert.equal(visibleState, "error");
});
