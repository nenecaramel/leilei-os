import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const router = readFileSync(new URL("../src/web-api/conversation-lifecycle-router.ts", import.meta.url), "utf8");

test("Conversation lifecycle exposes archive, recoverable delete, restore, and permanent-delete routes", () => {
  for (const route of ["/archive", "/deleted", "/:conversationId/archive", "/:conversationId/restore", "/:conversationId/restore-deleted", "/:conversationId/delete", "/:conversationId/permanent-delete", "/:conversationId/branches/:branchId/restore", "/:conversationId/branches/:branchId/permanent-delete"]) {
    assert.match(router, new RegExp(`router\\.(?:get|post)\\(\\"${route.replaceAll("/", "\\/")}`));
  }
});

test("Conversation lifecycle keeps permanent-delete scoped to explicit actions", () => {
  assert.match(router, /permanentlyDeleteConversation/);
  assert.match(router, /permanentlyDeleteBranch/);
  assert.match(router, /restoreDeletedConversation/);
});
