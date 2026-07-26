import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTaskListRequest,
  createLatestTaskRequestTracker,
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
