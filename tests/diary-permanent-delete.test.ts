import assert from "node:assert/strict";
import test from "node:test";
import {
  DiaryDomainError,
  DiaryService,
} from "../src/domains/diary/diary-service.js";

test("DiaryService permanently deletes through the repository with web lifecycle context", async () => {
  const calls: unknown[] = [];
  const repository = {
    findUserById: async () => ({ status: "active" as const }),
    permanentlyDeleteDiary: async (input: unknown) => {
      calls.push(input);
      return true;
    },
  };

  await new DiaryService(repository as never).permanentlyDeleteDiary({
    userId: " user-1 ",
    id: " diary-1 ",
  });

  assert.deepEqual(calls, [{
    userId: "user-1",
    id: "diary-1",
    actorType: "user",
    channel: "web",
  }]);
});

test("DiaryService permanent MCP delete records MCP lifecycle context", async () => {
  const calls: unknown[] = [];
  const repository = {
    findUserById: async () => ({ status: "active" as const }),
    permanentlyDeleteDiary: async (input: unknown) => {
      calls.push(input);
      return true;
    },
  };

  await new DiaryService(repository as never).permanentlyDeleteMcpDiary(
    { userId: " user-1 " },
    { id: " diary-1 " },
  );

  assert.deepEqual(calls, [{
    userId: "user-1",
    id: "diary-1",
    actorType: "user",
    channel: "mcp",
  }]);
});

test("DiaryService maps an ineligible permanent delete to DIARY_NOT_FOUND", async () => {
  const repository = {
    findUserById: async () => ({ status: "active" as const }),
    permanentlyDeleteDiary: async () => false,
  };

  await assert.rejects(
    new DiaryService(repository as never).permanentlyDeleteDiary({
      userId: "user-1",
      id: "diary-1",
    }),
    (error: unknown) =>
      error instanceof DiaryDomainError && error.code === "DIARY_NOT_FOUND",
  );
});

test("DiaryService rejects permanent deletion before repository access for disabled user", async () => {
  let called = false;
  const repository = {
    findUserById: async () => ({ status: "disabled" as const }),
    permanentlyDeleteDiary: async () => {
      called = true;
      return true;
    },
  };

  await assert.rejects(
    new DiaryService(repository as never).permanentlyDeleteDiary({
      userId: "user-1",
      id: "diary-1",
    }),
    (error: unknown) =>
      error instanceof DiaryDomainError && error.code === "USER_DISABLED",
  );
  assert.equal(called, false);
});
