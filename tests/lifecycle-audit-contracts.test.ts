import assert from "node:assert/strict";
import test from "node:test";

import {
  createLifecycleAuditEvent,
  WEB_USER_LIFECYCLE_CONTEXT,
  type LifecycleAction,
  type LifecycleResourceType,
} from "../src/domains/lifecycle/lifecycle-audit-repository.js";

test("Memory, Diary, and Task share the exact Web lifecycle audit contract", () => {
  assert.deepEqual(WEB_USER_LIFECYCLE_CONTEXT, {
    actorType: "user",
    channel: "web",
  });

  const cases: Array<{
    resourceType: LifecycleResourceType;
    action: LifecycleAction;
  }> = [
    { resourceType: "memory", action: "archive" },
    { resourceType: "memory", action: "restore" },
    { resourceType: "diary", action: "archive" },
    { resourceType: "diary", action: "restore" },
    { resourceType: "task", action: "archive" },
    { resourceType: "task", action: "restore" },
  ];

  for (const lifecycleCase of cases) {
    assert.deepEqual(
      createLifecycleAuditEvent({
        userId: "user-1",
        resourceType: lifecycleCase.resourceType,
        resourceId: `${lifecycleCase.resourceType}-1`,
        action: lifecycleCase.action,
        ...WEB_USER_LIFECYCLE_CONTEXT,
      }),
      {
        userId: "user-1",
        resourceType: lifecycleCase.resourceType,
        resourceId: `${lifecycleCase.resourceType}-1`,
        action: lifecycleCase.action,
        actorType: "user",
        channel: "web",
        metadata: {},
      },
    );
  }
});
