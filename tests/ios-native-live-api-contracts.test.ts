import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const root = "ios/LeileiOS/LeileiOS/";
const api = root + "Infrastructure/API/NativeLive/NativeLiveAPI.swift";
const contracts = root + "Infrastructure/API/NativeLive/NativeLiveAPIContracts.swift";

test("Native Live transport and DTO declarations conserve exact main contracts", () => {
  assert.ok(existsSync(contracts));
  // main@43bd21d3: only top-level private DTO visibility changes to internal.
  assert.equal(createHash("sha256").update(readFileSync(api)).digest("hex"), "590da9dd01df6d2c5d0e93bfc25ed0b89f9d1e2e0f1b762b6d96fd47314fff44");
  assert.equal(createHash("sha256").update(readFileSync(contracts)).digest("hex"), "1f522f558ea20c3db78b3f32ed4f88c18c1cdaf8dd1f40b944f4b0cf7bd00cf3");
  assert.doesNotMatch(readFileSync(contracts, "utf8"), /URLSession|Task|AppModel|public struct/);
});

test("actual Swift contracts preserve omitted versus null fields and response envelopes", { skip: process.platform !== "darwin" }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "native-live-contracts-"));
  try {
    let implementation = contracts;
    if (!existsSync(contracts)) {
      const source = readFileSync(api, "utf8");
      implementation = path.join(dir, "Contracts.swift");
      writeFileSync(implementation, "import Foundation\n" + source.slice(source.indexOf("private struct NativeLiveExternalSessionRequestEnvelope:")).replaceAll("private struct ", "struct "));
    }
    const files = [root + "Infrastructure/NativeLiveRuntimeModels.swift", root + "Infrastructure/API/NativeLive/NativeLiveModels.swift", root + "Infrastructure/API/NativeLive/NativeLiveInputMode.swift", implementation, "tests/fixtures/native-live-api-contracts.swift"];
    const build = spawnSync("xcrun", ["swiftc", "-parse-as-library", "-module-cache-path", path.join(dir, "cache"), ...files, "-o", path.join(dir, "check")], { encoding: "utf8", timeout: 180000 });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(path.join(dir, "check"), [], { encoding: "utf8", timeout: 60000 });
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Native Live contracts PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
