import assert from "node:assert/strict";
import test from "node:test";
import { planPendingMigrations } from "../src/database/migration-plan.js";

const migrations = [
  { folderMillis: 100, hash: "a", sql: ["one"] },
  { folderMillis: 200, hash: "b", sql: ["two"] },
  { folderMillis: 300, hash: "c", sql: ["three"] },
];

test("returns migrations after a contiguous compatible ledger", () => {
  const pending = planPendingMigrations(migrations, [
    { createdAt: 200, hash: "b" },
  ]);
  assert.deepEqual(pending, [migrations[2]]);
});

test("accepts a contiguous ledger containing all migrations from its bootstrap point", () => {
  const pending = planPendingMigrations(migrations, [
    { createdAt: 200, hash: "b" },
    { createdAt: 300, hash: "c" },
  ]);
  assert.deepEqual(pending, []);
});

test("rejects a ledger hash mismatch", () => {
  assert.throws(
    () => planPendingMigrations(migrations, [{ createdAt: 200, hash: "wrong" }]),
    /hash/i,
  );
});

test("rejects gaps after the bootstrap migration", () => {
  assert.throws(
    () => planPendingMigrations(migrations, [
      { createdAt: 100, hash: "a" },
      { createdAt: 300, hash: "c" },
    ]),
    /contiguous/i,
  );
});

test("rejects an unknown bootstrap migration", () => {
  assert.throws(
    () => planPendingMigrations(migrations, [{ createdAt: 150, hash: "x" }]),
    /known/i,
  );
});
