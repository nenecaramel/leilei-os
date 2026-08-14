import assert from "node:assert/strict";
import test from "node:test";
import { resolveRailwayMigrationDatabaseUrl } from "../src/database/railway-private-postgres.js";

test("leaves the database URL unchanged outside Railway", () => {
  const source = "postgresql://user:pass@roundhouse.proxy.rlwy.net:12345/app?sslmode=require";
  assert.equal(resolveRailwayMigrationDatabaseUrl(source, undefined), source);
});

test("rewrites a Railway TCP proxy URL to the Postgres private endpoint during Railway deploys", () => {
  const source = "postgresql://user:p%40ss@roundhouse.proxy.rlwy.net:12345/app?sslmode=require";
  const resolved = new URL(resolveRailwayMigrationDatabaseUrl(source, "production-env"));

  assert.equal(resolved.hostname, "postgres.railway.internal");
  assert.equal(resolved.port, "5432");
  assert.equal(resolved.username, "user");
  assert.equal(resolved.password, "p%40ss");
  assert.equal(resolved.pathname, "/app");
  assert.equal(resolved.searchParams.get("sslmode"), "require");
});

test("does not rewrite non-Railway database hosts", () => {
  const source = "postgresql://user:pass@example.com:5432/app";
  assert.equal(resolveRailwayMigrationDatabaseUrl(source, "production-env"), source);
});
