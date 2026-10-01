import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import test from "node:test";

const retiredPaths = [
  "web/src/pages/MemoryPage.tsx",
  "web/src/pages/MemoryPageContainer.tsx",
  "web/src/pages/TaskPage.tsx",
  "web/src/pages/TaskPageContainer.tsx",
  "web/src/pages/SharedPaperPage.tsx",
  "web/src/pages/SharedPaperPageContainer.tsx",
  "src/web-api/memory-router.ts",
  "src/web-api/task-router.ts",
  "src/web-api/shared-paper-router.ts",
  "src/domains/memory/memory-service.ts",
  "src/domains/memory/memory-repository.ts",
  "src/domains/task/task-service.ts",
  "src/domains/task/task-repository.ts",
  "src/domains/shared-paper/shared-paper-service.ts",
  "src/domains/shared-paper/shared-paper-repository.ts",
] as const;

test("retired Memory Task and Shared Paper product source is absent", () => {
  for (const path of retiredPaths) {
    assert.equal(
      existsSync(path),
      false,
      `${path} must stay retired`,
    );
  }
});

test("Web navigation and routes do not expose retired products", () => {
  const app = readFileSync(
    "web/src/App.tsx",
    "utf8",
  );
  const navigation = readFileSync(
    "web/src/layout/NavigationGroups.tsx",
    "utf8",
  );

  for (const route of [
    "/memory",
    "/task",
    "/shared-paper",
  ]) {
    assert.equal(app.includes(route), false);
    assert.equal(
      navigation.includes(route),
      false,
    );
  }

  for (const label of [
    "Memory",
    "Task",
    "Shared Paper",
  ]) {
    assert.equal(
      navigation.includes(`label: "${label}"`),
      false,
    );
  }
});

test("Web API and production runtime do not wire retired product services", () => {
  const router = readFileSync(
    "src/web-api/router.ts",
    "utf8",
  );
  const app = readFileSync(
    "src/app/create-app.ts",
    "utf8",
  );
  const runtime = readFileSync(
    "src/app/process-runtime.ts",
    "utf8",
  );
  const joined = [router, app, runtime].join("\n");

  for (const token of [
    "MemoryApiDependencies",
    "TaskApiDependencies",
    "SharedPaperApiDependencies",
    "webMemoryService",
    "webTaskService",
    "webSharedPaperService",
    "MemoryService",
    "TaskService",
    "SharedPaperService",
    "DrizzleMemoryRepository",
    "DrizzleTaskRepository",
    "DrizzleSharedPaperRepository",
  ]) {
    assert.equal(
      joined.includes(token),
      false,
      `retired runtime token remains: ${token}`,
    );
  }
});

test("search export and restore contracts expose active modules only", () => {
  const search = readFileSync(
    "src/domains/global-search/global-search-service.ts",
    "utf8",
  );
  const exportTypes = readFileSync(
    "src/domains/export/export-types.ts",
    "utf8",
  );
  const importSchema = readFileSync(
    "src/domains/import/import-schema.ts",
    "utf8",
  );

  for (const retired of [
    "ExportMemoryRecord",
    "ExportTaskRecord",
    "ExportSharedPaper",
    "memoryRecord",
    "taskRecord",
    "sharedPaper",
  ]) {
    assert.equal(
      [search, exportTypes, importSchema]
        .join("\n")
        .includes(retired),
      false,
      `retired contract token remains: ${retired}`,
    );
  }

  assert.match(
    search,
    /DEFAULT_MODULES = \["diary", "todo", "universe"\]/,
  );
  assert.doesNotMatch(search, /"memory"|"task"|"shared_paper"/);
  assert.match(
    exportTypes,
    /ExportDocument = ExportDocumentV4/,
  );
});


test("retired Phase 2 Memory seed tooling stays absent", () => {
  assert.equal(existsSync("scripts/seed-phase-2.ts"), false);
  const rootPackage = JSON.parse(
    readFileSync("package.json", "utf8"),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      rootPackage.scripts ?? {},
      "db:seed:phase2",
    ),
    false,
  );
  const envExample = readFileSync(".env.example", "utf8");
  assert.equal(envExample.includes("SEED_CONTENT_AUTHOR"), false);
});
