import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { swiftc, swiftUnavailable } from "./helpers/swift-toolchain.js";

test("a signed-out Claude tells the owner what to do; other codes are unchanged", { skip: swiftUnavailable, timeout: 120_000 }, (t) => {
  const source = readFileSync("ios/LeileiOS/LeileiOS/App/AppModel.swift", "utf8");
  const declaration = /^enum NativeLiveSendError: LocalizedError \{\n[\s\S]*?^\}/mu.exec(source)?.[0];
  assert.ok(declaration);
  const dir = mkdtempSync(join(tmpdir(), "leilei-send-error-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "main.swift"), `import Foundation
${declaration}
for code in ["CLAUDE_LOGIN_REQUIRED", "CLAUDE_PROCESS_FAILED", nil] as [String?] {
    print((NativeLiveSendError.failed(code: code) as Error).localizedDescription)
}
`);
  const [command, args] = swiftc([join(dir, "main.swift"), "-o", join(dir, "run")]);
  execFileSync(command, args, { stdio: "pipe" });
  const [login, processFailed, missing] = execFileSync(join(dir, "run"), { encoding: "utf8" }).trim().split("\n");
  assert.match(login, /signed out on the Mac.*claude auth login/u);
  assert.equal(processFailed, "CLAUDE_PROCESS_FAILED");
  assert.equal(missing, "Failed");
});
