import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../src/database/client.js";

test("database resource probes and closes one underlying client", async () => {
  let factoryCalls = 0;
  let probeCalls = 0;
  let endCalls = 0;
  const fakeClient = Object.assign(
    async (_parts: TemplateStringsArray) => {
      probeCalls += 1;
      return [{ value: 1 }];
    },
    {
      end: async () => {
        endCalls += 1;
      },
    },
  );

  const resource = createDatabase("postgres://example.invalid/db", {
    createClient: () => {
      factoryCalls += 1;
      return fakeClient as never;
    },
    createDrizzle: () => ({ shared: true }) as never,
  });

  assert.equal(factoryCalls, 1);
  await resource.probe();
  assert.equal(probeCalls, 1);
  await Promise.all([resource.close(), resource.close()]);
  await resource.close();
  assert.equal(endCalls, 1);
});
