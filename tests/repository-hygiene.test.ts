import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  assert.match(agents, /exactly one long-lived LeileiOS checkout/i);
  assert.match(agents, /Do not create another\s+persistent clone\/worktree/i);
  assert.doesNotMatch(hygieneScript, /leilei-os-ui/);
  assert.doesNotMatch(readFileSync("scripts/leileios-switch.command", "utf8"), /leilei-os-ui/);
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


test("hygiene cleans build output while preserving Xcode user data, tracked files and symlink targets", () => {
  const container = mkdtempSync(join(tmpdir(), "leileios-hygiene-contract-"));
  const repo = join(container, "repo");
  const outside = join(container, "external");
  mkdirSync(repo);
  mkdirSync(outside);
  const write = (path: string, value: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), value);
  };
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: repo });
    write("scripts/local-hygiene.mjs", readFileSync("scripts/local-hygiene.mjs", "utf8"));
    write("tracked/dist/important.txt", "tracked content");
    execFileSync("git", ["add", "."], { cwd: repo });
    const userFiles = [
      "ios/App.xcodeproj/xcuserdata/Fixture.xcuserdatad/xcschemes/xcschememanagement.plist",
      "ios/App.xcodeproj/project.xcworkspace/xcuserdata/Fixture.xcuserdatad/UserInterfaceState.xcuserstate",
      "ios/App.xcodeproj/xcuserdata/nested/dist/state.txt",
      "ios/App.xcodeproj/xcuserdata/nested/cache.tsbuildinfo",
    ];
    for (const path of userFiles) write(path, `private fixture ${path}`);
    write("web/dist/bundle.js", "generated");
    write("web/tsconfig.app.tsbuildinfo", "generated");
    writeFileSync(join(outside, "keep.txt"), "external content");
    symlinkSync(outside, join(repo, "dist"));
    const run = (mode: string) => execFileSync(process.execPath, ["scripts/local-hygiene.mjs", mode], {
      cwd: repo, encoding: "utf8", timeout: 10_000,
    });
    run("--clean");
    for (const path of userFiles) assert.equal(readFileSync(join(repo, path), "utf8"), `private fixture ${path}`);
    assert.equal(existsSync(join(repo, "web/dist")), false);
    assert.equal(existsSync(join(repo, "web/tsconfig.app.tsbuildinfo")), false);
    assert.equal(readFileSync(join(repo, "tracked/dist/important.txt"), "utf8"), "tracked content");
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "external content");
    assert.match(run("--check"), /hygiene: clean/);
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});
