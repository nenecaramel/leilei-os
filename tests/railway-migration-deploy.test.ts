import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readRepoFile = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Railway config runs the compiled database migrator before deploy", () => {
  const configUrl = new URL("../railway.json", import.meta.url);
  assert.equal(existsSync(configUrl), true, "railway.json must exist");

  const config = JSON.parse(readFileSync(configUrl, "utf8")) as {
    build?: { builder?: string; dockerfilePath?: string };
    deploy?: { preDeployCommand?: string };
  };

  assert.equal(config.build?.builder, "DOCKERFILE");
  assert.equal(config.build?.dockerfilePath, "Dockerfile");
  assert.equal(config.deploy?.preDeployCommand, "node dist/database/migrate.js");
});

test("runtime image contains checked-in Drizzle migrations", () => {
  const dockerfile = readRepoFile("Dockerfile");
  assert.match(dockerfile, /COPY\s+drizzle\s+\.\/drizzle/);
});

test("production migration entrypoint uses the Drizzle postgres-js migrator", () => {
  const migrateUrl = new URL("../src/database/migrate.ts", import.meta.url);
  assert.equal(existsSync(migrateUrl), true, "src/database/migrate.ts must exist");

  const source = readFileSync(migrateUrl, "utf8");
  assert.match(source, /drizzle-orm\/postgres-js\/migrator/);
  assert.match(source, /migrationsFolder:\s*["']\.\/drizzle["']/);
  assert.match(source, /DATABASE_URL/);
});
