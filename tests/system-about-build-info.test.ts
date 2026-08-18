import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeSystemBuildInfo,
} from "../web/src/system/build-metadata.js";

const packageJson = JSON.parse(
  readFileSync(
    new URL("../web/package.json", import.meta.url),
    "utf8",
  ),
) as {
  version: string;
};

const viteSource = readFileSync(
  new URL("../web/vite.config.ts", import.meta.url),
  "utf8",
);

const aboutSource = readFileSync(
  new URL("../web/src/pages/SystemAboutPage.tsx", import.meta.url),
  "utf8",
);

test("web package remains on the approved 0.1.0 version", () => {
  assert.equal(packageJson.version, "0.1.0");
});

test("build metadata normalizes commit and environment without inventing unavailable values", () => {
  assert.deepEqual(
    normalizeSystemBuildInfo({
      version: "0.1.0",
      commit:
        "1234567890abcdef1234567890abcdef12345678",
      mode: "production",
    }),
    {
      version: "0.1.0",
      commit: "1234567",
      environment: "Production",
    },
  );

  assert.deepEqual(
    normalizeSystemBuildInfo({
      version: "",
      commit: "",
      mode: "development",
    }),
    {
      version: "Local",
      commit: "Unavailable",
      environment: "Development",
    },
  );
});

test("Vite injects version, commit and mode at build time from safe metadata only", () => {
  assert.match(viteSource, /loadEnv/);
  assert.match(
    viteSource,
    /RAILWAY_GIT_COMMIT_SHA/,
  );
  assert.match(viteSource, /GITHUB_SHA/);
  assert.match(
    viteSource,
    /VERCEL_GIT_COMMIT_SHA/,
  );
  assert.match(
    viteSource,
    /__LEILEI_VERSION__/,
  );
  assert.match(
    viteSource,
    /__LEILEI_COMMIT__/,
  );
  assert.match(
    viteSource,
    /__LEILEI_MODE__/,
  );

  assert.match(
    viteSource,
    /slice\(0,\s*7\)/,
  );

  assert.doesNotMatch(
    viteSource,
    /TOKEN|SECRET|DATABASE_URL|AUTH0_CLIENT_SECRET/i,
  );
});

test("About wrapper consumes build metadata and has no connection duplication", () => {
  assert.match(
    aboutSource,
    /SYSTEM_BUILD_INFO/,
  );

  assert.doesNotMatch(
    aboutSource,
    /Web API|ChatGPT|MCP|Connection/i,
  );
});
