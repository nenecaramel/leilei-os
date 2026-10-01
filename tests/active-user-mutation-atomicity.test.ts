import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const helperPath = "src/domains/require-active-user-transaction.ts";
const helperName = "requireActiveUserInTransaction";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

test("durable write repositories share one transaction-scoped active-user guard", () => {
  assert.equal(
    existsSync(helperPath),
    true,
    "transaction-scoped active-user guard must exist",
  );

  const helper = source(helperPath);
  assert.match(helper, /\.for\(["']share["']\)/);
  assert.match(helper, /requireActiveUser\(/);

  const expectedGuards = new Map<string, number>([
    ["src/domains/diary/diary-repository.ts", 4],
    ["src/domains/todo/todo-repository.ts", 2],
    ["src/domains/universe/universe-repository-drizzle.ts", 1],
  ]);

  for (const [path, minimum] of expectedGuards) {
    const repository = source(path);
    assert.match(repository, new RegExp(helperName));
    assert.ok(
      countOccurrences(repository, `${helperName}(`) >= minimum,
      `${path} must guard every durable mutation path inside its transaction`,
    );
  }
});
