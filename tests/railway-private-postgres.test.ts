import assert from "node:assert/strict";
import test from "node:test";
import { resolveRailwayMigrationDatabaseUrl } from "../src/database/railway-private-postgres.js";

test("leaves the database URL unchanged outside Railway", () => {
  const source = "postgresql://user:pass@roundhouse.proxy.rlwy.net:12345/app?sslmode=require";
  assert.equal(resolveRailwayMigrationDatabaseUrl(source, undefined), source);
});

test("uses Railway DATABASE_URL unchanged during Railway deploys", () => {
  const source = "postgresql://user:p%40ss@roundhouse.proxy.rlwy.net:12345/app?sslmode=require";
  assert.equal(resolveRailwayMigrationDatabaseUrl(source, "production-env"), source);
});

test("does not rewrite non-Railway database hosts", () => {
  const source = "postgresql://user:pass@example.com:5432/app";
  assert.equal(resolveRailwayMigrationDatabaseUrl(source, "production-env"), source);
});
