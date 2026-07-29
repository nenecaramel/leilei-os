import assert from "node:assert/strict";
import test from "node:test";
import {
  DrizzleLifecycleAuditPersistence,
} from "../src/domains/lifecycle/lifecycle-audit-repository.js";

test("lifecycle audit persistence records only server-owned structural fields", async () => {
  let values: unknown;
  const transaction = {
    insert() {
      return {
        async values(input: unknown) {
          values = input;
        },
      };
    },
  };
  const persistence = new DrizzleLifecycleAuditPersistence();

  await persistence.record(transaction as never, {
    userId: "user-1",
    resourceType: "memory",
    resourceId: "memory-1",
    action: "archive",
    actorType: "user",
    channel: "web",
    metadata: {},
  });

  assert.deepEqual(values, {
    userId: "user-1",
    resourceType: "memory",
    resourceId: "memory-1",
    action: "archive",
    actorType: "user",
    channel: "web",
    metadata: {},
  });
});
