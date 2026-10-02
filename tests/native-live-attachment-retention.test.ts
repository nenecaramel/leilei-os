import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteExpiredNativeLiveAttachmentsBatch,
} from "../src/domains/bridge/attachment/native-live-attachment-service.js";

test("attachment retention deletes object before durable metadata row", async () => {
  const order: string[] = [];
  const db = {
    async transaction(operation: (tx: any) => Promise<any>) { return operation(db); },
    async execute() {
      return [{
        id: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        objectKey:
          "native-live/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111",
      }];
    },
    delete() {
      order.push("db-delete");
      return {
        where() {
          return {
            async returning() {
              return [{ id: "11111111-1111-4111-8111-111111111111" }];
            },
          };
        },
      };
    },
  };
  const store = {
    async deleteObject() {
      order.push("object-delete");
    },
  };

  const deleted =
    await deleteExpiredNativeLiveAttachmentsBatch(
      db as never,
      store,
      new Date("2026-09-30T04:00:00.000Z"),
      10,
    );

  assert.equal(deleted, 1);
  assert.deepEqual(order, [
    "object-delete",
    "db-delete",
  ]);
});

test("attachment retention fails closed when object deletion fails", async () => {
  let databaseDeleteCalls = 0;
  const db = {
    async transaction(operation: (tx: any) => Promise<any>) { return operation(db); },
    async execute() {
      return [{
        id: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        objectKey: "native-live/user/object",
      }];
    },
    delete() {
      databaseDeleteCalls += 1;
      throw new Error("metadata must remain");
    },
  };
  const store = {
    async deleteObject() {
      throw new Error("bucket unavailable");
    },
  };

  const deleted =
    await deleteExpiredNativeLiveAttachmentsBatch(
      db as never,
      store,
      new Date("2026-09-30T04:00:00.000Z"),
      10,
    );

  assert.equal(deleted, 0);
  assert.equal(databaseDeleteCalls, 0);
});


for (const hasInlineContent of [true, false]) {
  test(`cutover retention deletes ${hasInlineContent ? "inline and any staged Bucket" : "Bucket"} bytes before metadata`, async () => {
    const order: string[] = [];
    const db = {
      async transaction(operation: (tx: any) => Promise<any>) { return operation(db); },
      async execute() { return [{ id: "id", userId: "user", objectKey: "native-live/user/attachment", hasInlineContent }]; },
      delete() { order.push("metadata"); return { where() { return { async returning() { return [{ id: "id" }]; } }; } }; },
    };
    const primary = { async deleteObject() { order.push("bucket"); } };
    const legacy = { async deleteObject() { order.push("inline"); } };
    const fn = deleteExpiredNativeLiveAttachmentsBatch as (...args: any[]) => Promise<number>;
    assert.equal(await fn(db, primary, new Date(), 10, legacy), 1);
    assert.deepEqual(order, hasInlineContent ? ["bucket", "inline", "metadata"] : ["bucket", "metadata"]);
  });
}
