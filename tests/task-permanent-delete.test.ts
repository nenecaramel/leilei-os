import assert from "node:assert/strict";
import test from "node:test";
import {
  TaskDomainError,
  TaskService,
} from "../src/domains/task/task-service.js";

test("TaskService permanently deletes through the repository with web lifecycle context", async () => {
  const calls: unknown[] = [];
  const repository = {
    findUserById: async () => ({ status: "active" as const }),
    permanentlyDeleteTask: async (input: unknown) => {
      calls.push(input);
      return true;
    },
  };

  await new TaskService(repository as never).permanentlyDeleteTask({
    userId: " user-1 ",
    id: " task-1 ",
  });

  assert.deepEqual(calls, [{
    userId: "user-1",
    id: "task-1",
    actorType: "user",
    channel: "web",
  }]);
});

test("TaskService maps an ineligible permanent delete to TASK_NOT_FOUND", async () => {
  const repository = {
    findUserById: async () => ({ status: "active" as const }),
    permanentlyDeleteTask: async () => false,
  };

  await assert.rejects(
    new TaskService(repository as never).permanentlyDeleteTask({
      userId: "user-1",
      id: "task-1",
    }),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "TASK_NOT_FOUND",
  );
});

test("TaskService rejects permanent deletion before repository access for disabled user", async () => {
  let called = false;
  const repository = {
    findUserById: async () => ({ status: "disabled" as const }),
    permanentlyDeleteTask: async () => {
      called = true;
      return true;
    },
  };

  await assert.rejects(
    new TaskService(repository as never).permanentlyDeleteTask({
      userId: "user-1",
      id: "task-1",
    }),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "USER_DISABLED",
  );
  assert.equal(called, false);
});
