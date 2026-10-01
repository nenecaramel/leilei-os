import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import test from "node:test";

const authoritativeDocs = [
  "README.md",
  "docs/architecture.md",
  "docs/deployment.md",
  "docs/troubleshooting.md",
];

test("repository uses pnpm workspace build policy without obsolete root npm config", () => {
  assert.equal(existsSync(".npmrc"), false);

  const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
  assert.match(workspace, /allowBuilds:\s*\n\s*esbuild:\s*true/);
});

test("authoritative docs track the checked-in migration journal head", () => {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as {
    entries?: Array<{ tag?: string }>;
  };
  const migrationHead = journal.entries?.at(-1)?.tag;

  assert.equal(typeof migrationHead, "string");
  assert.ok(migrationHead);
  assert.ok(existsSync(`drizzle/${migrationHead}.sql`));

  for (const path of authoritativeDocs) {
    const source = readFileSync(path, "utf8");
    assert.ok(
      source.includes("drizzle/meta/_journal.json"),
      `${path} must direct readers to the canonical migration journal`,
    );
  }
});

test("Shared Paper MCP App removal leaves no runtime or build residue", () => {
  assert.equal(
    existsSync("src/mcp/tools/shared-paper-app"),
    false,
  );
  assert.equal(
    existsSync("scripts/build-shared-paper-app-browser.mjs"),
    false,
  );

  const rootPackage = readFileSync("package.json", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const productionFactory = readFileSync(
    "src/mcp/server/production-server-factory.ts",
    "utf8",
  );

  for (const source of [
    rootPackage,
    dockerfile,
    productionFactory,
  ]) {
    assert.doesNotMatch(source, /open_shared_paper_app/);
    assert.doesNotMatch(source, /shared-paper-app/);
    assert.doesNotMatch(
      source,
      /build-shared-paper-app-browser/,
    );
  }
});


test("coding-agent workspace policy is enforced by closeout commands", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  const rootPackage = JSON.parse(
    readFileSync("package.json", "utf8"),
  ) as {
    scripts?: Record<string, string>;
  };
  const hygieneScript = readFileSync(
    "scripts/local-hygiene.mjs",
    "utf8",
  );
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.match(agents, /only long-lived LeileiOS working copies/i);
  assert.match(agents, /Do not create persistent clones, worktrees/i);
  assert.match(agents, /pnpm hygiene:finish/);
  assert.equal(
    rootPackage.scripts?.["hygiene:finish"],
    "pnpm hygiene:clean && pnpm hygiene:check",
  );
  assert.match(hygieneScript, /Mobile Documents/);
  assert.match(hygieneScript, /git\(\["ls-files"/);
  assert.match(gitignore, /\*\.tsbuildinfo/);
  assert.match(gitignore, /\*\*\/xcuserdata\//);
});
