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
  // Preserve main@43bd21d3 after reversing only the exact accepted 6d39a039
  // call marker additions; a missing/changed addition cannot be normalized away.
  const removeAccepted = (source: string, added: string, previous = "") => {
    assert.equal(source.split(added).length, 2, `Accepted call addition: ${added}`);
    return source.replace(added, previous);
  };
  let transport=readFileSync(api,"utf8");
  transport=removeAccepted(transport, "        interactionMode: String? = nil,\n");
  transport=removeAccepted(transport, "                inputMode: inputMode,\n                interactionMode: interactionMode", "                inputMode: inputMode");
  let dto=readFileSync(contracts,"utf8");
  dto=removeAccepted(dto,"    var interactionMode: String? = nil\n");
  dto=removeAccepted(dto,'        case interactionMode = "interaction_mode"\n');
  dto=removeAccepted(dto,'            if interactionMode == "live_call" {\n                try container.encode("live_call", forKey: .interactionMode)\n            }\n');
  assert.equal(createHash("sha256").update(transport).digest("hex"), "590da9dd01df6d2c5d0e93bfc25ed0b89f9d1e2e0f1b762b6d96fd47314fff44");
  assert.equal(createHash("sha256").update(dto).digest("hex"), "1f522f558ea20c3db78b3f32ed4f88c18c1cdaf8dd1f40b944f4b0cf7bd00cf3");
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
    // Execute the actual DTO with voice/text and allowed/unknown markers. This
    // catches both marker leaks into typed messages and unvalidated voice modes.
    const harness=path.join(dir,"ContractsChecks.swift");
    const extra=`
        for mode: NativeLiveInputMode in [.text, .voice] {
            for marker: String? in [nil, "live_call", "unknown"] {
                let send = try object(NativeLiveSendBody(dispatchTarget: "claude_code", requestId: "r", operation: "send", conversationId: "c", expectedHeadMessageId: nil, text: "text", attachmentIds: [], execution: nil, inputMode: mode, interactionMode: marker))
                let expected = mode == .voice && marker == "live_call"
                precondition((send["interaction_mode"] as? String) == (expected ? "live_call" : nil))
                precondition((send["input_mode"] as? String) == (mode == .voice ? "voice" : nil))
            }
        }
    `;
    writeFileSync(harness,readFileSync("tests/fixtures/native-live-api-contracts.swift","utf8").replace('        print("Native Live contracts PASS")',extra+'        print("Native Live contracts PASS")'));
    const files = [root + "Infrastructure/NativeLiveRuntimeModels.swift", root + "Infrastructure/API/NativeLive/NativeLiveModels.swift", root + "Infrastructure/API/NativeLive/NativeLiveInputMode.swift", implementation, harness];
    const build = spawnSync("xcrun", ["swiftc", "-parse-as-library", "-module-cache-path", path.join(dir, "cache"), ...files, "-o", path.join(dir, "check")], { encoding: "utf8", timeout: 180000 });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(path.join(dir, "check"), [], { encoding: "utf8", timeout: 60000 });
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Native Live contracts PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
