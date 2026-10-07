import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const jobs = new Map(
  [...workflow.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)]
    .map((match) => [match[1], match[2]]),
);

test("CI keeps one scoped verification job plus the gated Postgres job", () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.deepEqual([...jobs.keys()], ["checks", "postgres-regressions"]);

  const checks = jobs.get("checks")!;
  assert.match(checks, /outputs:\s*\n\s*postgres: \$\{\{ steps\.scope\.outputs\.postgres \}\}/);
  assert.match(checks, /Determine changed areas/);
  assert.match(checks, /id: scope/);
  assert.match(checks, /Verify exact event head/);
  assert.match(
    checks,
    /ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
  );
  assert.match(checks, /test "\$actual" = "\$expected"/);

  const postgres = jobs.get("postgres-regressions")!;
  assert.match(postgres, /needs: checks/);
  assert.match(postgres, /if: needs\.checks\.outputs\.postgres == 'true'/);
  assert.match(postgres, /Verify exact event head/);

  assert.doesNotMatch(workflow, /continue-on-error:|\|\| true|known\.failures|allowlist/i);
});

test("CI scopes Core, Web, wake broker and Postgres work without leaking database access", () => {
  const checks = jobs.get("checks")!;
  const postgres = jobs.get("postgres-regressions")!;

  assert.doesNotMatch(checks, /DATABASE_URL|image: postgres|pnpm db:migrate/);
  assert.match(postgres, /DATABASE_URL:/);
  assert.match(postgres, /image: postgres:18/);

  for (const command of ["pnpm test", "pnpm typecheck", "pnpm check:generated", "pnpm build", "git diff --check"]) {
    assert.ok(checks.includes(command), command);
  }
  for (const command of ["npm ci", "npm run typecheck", "npm run build"]) {
    assert.ok(checks.includes(command), command);
  }
  assert.match(checks, /go test \.\/\.\.\./);

  assert.match(checks, /if: steps\.scope\.outputs\.core == 'true'/);
  assert.match(checks, /if: steps\.scope\.outputs\.web == 'true' && steps\.scope\.outputs\.core != 'true'/);
  assert.match(checks, /if: steps\.scope\.outputs\.web == 'true'/);
  assert.match(checks, /if: steps\.scope\.outputs\.wake == 'true'/);

  for (const command of [
    "pnpm db:migrate",
    "pnpm db:check",
    "pnpm test:isolated-postgres-regressions",
    "tests/data-retention.integration.test.ts",
    "tests/active-user-mutation-atomicity.integration.test.ts",
  ]) {
    assert.ok(postgres.includes(command), command);
  }
});

test("CI path scoping keeps iOS/docs-only changes out of hosted Core/Web/Postgres work", () => {
  const checks = jobs.get("checks")!;
  assert.match(checks, /pull_request:[\s\S]*paths-ignore:/);
  assert.match(workflow, /- "ios\/\*\*"/);
  assert.match(workflow, /- "docs\/\*\*"/);

  assert.match(checks, /case "\$file" in[\s\S]*ios\/\*\|docs\/\*\|\*\.md\)[\s\S]*;;/);
  assert.match(
    checks,
    /src\/\*\|tests\/\*\|drizzle\/\*\|drizzle\.config\.ts\|package\.json\|pnpm-lock\.yaml\|pnpm-workspace\.yaml\|tsconfig\.json\|scripts\/\*\)[\s\S]*postgres=true/,
  );
  assert.match(checks, /echo "core=\$core" >> "\$GITHUB_OUTPUT"/);
  assert.match(checks, /echo "web=\$web" >> "\$GITHUB_OUTPUT"/);
  assert.match(checks, /echo "wake=\$wake" >> "\$GITHUB_OUTPUT"/);
  assert.match(checks, /echo "postgres=\$postgres" >> "\$GITHUB_OUTPUT"/);
});
