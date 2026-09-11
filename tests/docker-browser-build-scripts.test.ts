import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Docker build stage copies every browser builder referenced by root build", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: { build?: string };
  };
  const build = pkg.scripts?.build ?? "";
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const scripts = [...build.matchAll(/scripts\\/build-[a-z0-9-]+-browser\\.mjs/g)]
    .map((match) => match[0]);

  assert.ok(scripts.length >= 3);
  for (const script of scripts) {
    assert.ok(
      dockerfile.includes(`COPY ${script} ./${script}`),
      `Dockerfile must copy ${script} before pnpm build`,
    );
  }
});
