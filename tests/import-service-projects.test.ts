import assert from "node:assert/strict";
import test from "node:test";
import { ImportService } from "../src/domains/import/import-service.js";
import { USER_ID, v3PackageBytes, v4PackageBytes, FakeImportRepository } from "./helpers/import-service-fixtures.js";
for (const [version, bytes] of [[3, v3PackageBytes], [4, v4PackageBytes]] as const) {
  test(`v${version} retired Product Workspace backup fails explicitly before any restore write`, async () => {
    const repository = new FakeImportRepository({ diary: [], todo: [] });
    const service = new ImportService(repository), raw = bytes();
    await assert.rejects(service.preview(raw, USER_ID), /retired Product Workspace data/);
    await assert.rejects(service.execute(raw, USER_ID, "a".repeat(64)), /retired Product Workspace data/);
    assert.equal(repository.writes, 0);
  });
}
