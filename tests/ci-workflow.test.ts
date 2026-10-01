import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const jobs = new Map([...workflow.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)].map(match => [match[1], match[2]]));
const independent = ["canonical-tests", "postgres-regressions", "root-checks", "web-checks", "wake-broker"];

test("CI reports all verification surfaces independently for PR and push", () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  for (const name of independent) {
    const job = jobs.get(name);
    assert.ok(job, `missing independent job: ${name}`);
    assert.doesNotMatch(job, /\bneeds:/);
    assert.match(job, /Verify exact event head/);
    assert.match(job, /ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
    assert.match(job, /test "\$actual" = "\$expected"/);
  }
  assert.doesNotMatch(workflow, /continue-on-error:|\|\| true|known.failures|allowlist/i);
});

test("CI scopes database access to Postgres gates and preserves every verification command", () => {
  for (const [name, job] of jobs) {
    if (name !== "postgres-regressions") assert.doesNotMatch(job, /DATABASE_URL|image: postgres|pnpm db:migrate/);
  }
  assert.match(jobs.get("canonical-tests")!, /run: pnpm test\s*$/m);
  for (const command of ["pnpm db:migrate", "pnpm db:check", "pnpm test:isolated-postgres-regressions", "tests/data-retention.integration.test.ts", "tests/active-user-mutation-atomicity.integration.test.ts"])
    assert.ok(jobs.get("postgres-regressions")!.includes(command), command);
  for (const command of ["pnpm typecheck", "pnpm check:generated", "pnpm build", "git diff --check"])
    assert.ok(jobs.get("root-checks")!.includes(command), command);
  for (const command of ["npm ci", "npm run typecheck", "npm run build"])
    assert.ok(jobs.get("web-checks")!.includes(command), command);
  assert.match(jobs.get("wake-broker")!, /go test \.\/\.\.\./);
});

test("CI checks after a failed gate still run once their setup succeeds", () => {
  for (const name of ["root-checks", "web-checks", "postgres-regressions"]) {
    const job = jobs.get(name)!;
    assert.match(job, /if: \$\{\{ !cancelled\(\) && steps\.[a-z]+\.outcome == 'success'/, name);
  }
});
