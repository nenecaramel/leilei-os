import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Docker build stage copies every browser builder referenced by root build", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: { build?: string };
  };
  const build = pkg.scripts?.build ?? "";
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const scripts = [...build.matchAll(/scripts\/build-[a-z0-9-]+-browser\.mjs/g)]
    .map((match) => match[0]);

  assert.deepEqual(scripts, ["scripts/build-mcp-browser.mjs"]);
  for (const script of scripts) {
    assert.ok(
      dockerfile.includes(`COPY ${script} ./${script}`),
      `Dockerfile must copy ${script} before pnpm build`,
    );
  }
});

test("Docker build stage copies every repository file the production runtime gate reads", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  const gate = pkg.scripts?.["test:production-runtime-gate"] ?? "";
  const dockerfile = readFileSync("Dockerfile", "utf8");
  // The image copies these trees whole; anything else a gate test reads must be copied explicitly.
  const copiedTrees = ["src/", "drizzle/", "tests/", "tools/claude-bridge/"];
  const testFiles = [...gate.matchAll(/(?:tests|tools\/claude-bridge\/test)\/[\w./-]+\.test\.(?:ts|mjs)/g)].map(m => m[0]);
  assert.ok(testFiles.length > 10);
  const reads = new Set<string>();
  for (const file of testFiles) {
    const source = readFileSync(file, "utf8");
    for (const [, path] of source.matchAll(/["'`]((?:scripts|docs|web|ios|\.agent)\/[\w./-]+)["'`]/g)) reads.add(path!);
  }
  for (const path of reads) {
    assert.ok(copiedTrees.some(tree => path.startsWith(tree)) || dockerfile.includes(`COPY ${path} ./${path}`),
      `Dockerfile must copy ${path}: the production runtime gate reads it during the image build`);
  }
});

test("Docker runtime gate installs the bridge's independent locked dependencies in the build stage", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const [build, runtime] = dockerfile.split(/FROM node:22-alpine AS runtime/);
  assert.ok(build && runtime);
  const bridgeCopy = build.indexOf("COPY tools/claude-bridge ./tools/claude-bridge");
  const bridgeInstall = build.indexOf("RUN pnpm --dir tools/claude-bridge install --frozen-lockfile");
  const gate = build.indexOf("RUN pnpm test:production-runtime-gate");
  assert.ok(bridgeCopy >= 0 && bridgeInstall > bridgeCopy && gate > bridgeInstall,
    "the gate imports the real SDK adapter, so its separately locked bridge dependencies must be installed first");
  assert.doesNotMatch(runtime, /COPY.*tools\/claude-bridge|--dir tools\/claude-bridge/,
    "test-only SDK dependencies must not be copied into the production server image");
});
