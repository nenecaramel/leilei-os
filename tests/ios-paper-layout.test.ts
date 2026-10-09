import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Explicit disposable simulator only. The fixture hosts production components,
// retains TextKit 2 and checks every visible line against the paper grid.
test(
  "iOS Diary, Memory and Todo visible lines stay centered on the ruled grid",
  {
    skip:
      process.platform !== "darwin" || !process.env.PAPER_LAYOUT_SIMULATOR_ID
        ? "Requires PAPER_LAYOUT_SIMULATOR_ID (disposable simulator)"
        : false,
    timeout: 180_000,
  },
  () => {
    const temporary = mkdtempSync(join(tmpdir(), "leilei-paper-layout-test-"));
    const simulator = process.env.PAPER_LAYOUT_SIMULATOR_ID!;
    const bundle = "test.leilei.paper-layout-regression";
    const run = (command: string, args: string[], timeout = 120_000) => {
      const result = spawnSync(command, args, {
        encoding: "utf8",
        timeout,
        maxBuffer: 8_000_000,
      });
      assert.equal(
        result.status,
        0,
        result.error?.message || result.stderr || result.stdout,
      );
      return result.stdout;
    };
    try {
      const app = join(temporary, "Checks.app");
      mkdirSync(app);
      writeFileSync(
        join(app, "Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundle}</string><key>CFBundleExecutable</key><string>Checks</string>
<key>CFBundlePackageType</key><string>APPL</string><key>MinimumOSVersion</key><string>18.0</string>
<key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><false/></dict>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array><key>UILaunchScreen</key><dict/>
</dict></plist>`,
      );
      const root = "ios/LeileiOS/LeileiOS/Pages/DaySpace/";
      // Compile the real rules, without unrelated API/model dependencies in the card file.
      const cards = readFileSync(root + "DaySpacePaperCards.swift", "utf8");
      function declaration(source: string, name: string) {
        const start = source.indexOf(name);
        assert.ok(start >= 0, name);
        let depth = 0;
        for (let i = source.indexOf("{", start); i < source.length; i++) {
          if (source[i] === "{") depth++;
          if (source[i] === "}" && --depth === 0)
            return source.slice(start, i + 1);
        }
        throw new Error(`Unclosed Swift declaration: ${name}`);
      }
      const rules = join(temporary, "Rules.swift");
      writeFileSync(
        rules,
        "import SwiftUI\n" +
          declaration(cards, "struct DaySpacePaperRules: View"),
      );
      const models = join(temporary, "Models.swift");
      const source = readFileSync(root + "DaySpaceModels.swift", "utf8");
      writeFileSync(
        models,
        "import Foundation\n" +
          declaration(source, "struct DaySpaceTodoFocusRequest: Equatable") +
          "\n" +
          declaration(source, "enum DaySpaceTodoEntryKind: String, Codable"),
      );
      const sdk = run("xcrun", [
        "--sdk",
        "iphonesimulator",
        "--show-sdk-path",
      ]).trim();
      run("xcrun", [
        "swiftc",
        "-sdk",
        sdk,
        "-target",
        `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-ios18.0-simulator`,
        "-module-cache-path",
        join(temporary, "cache"),
        root + "Layout/DaySpacePaperDetailLayer.swift",
        root + "Editors/DaySpacePaperBodyEditor.swift",
        rules,
        models,
        root + "Editors/DaySpaceTodoEditor.swift",
        "tests/fixtures/ios-paper-layout/Checks.swift",
        "-o",
        join(app, "Checks"),
      ]);
      run("xcrun", ["simctl", "install", simulator, app]);
      run(
        "xcrun",
        [
          "simctl",
          "launch",
          "--console",
          "--terminate-running-process",
          simulator,
          bundle,
        ],
        60_000,
      );
      // Read the atomic result from this synthetic app's own container. Console
      // output may be dropped when an iOS test process exits after a large failure.
      const container = run("xcrun", [
        "simctl",
        "get_app_container",
        simulator,
        bundle,
        "data",
      ]).trim();
      const report = JSON.parse(
        readFileSync(
          join(container, "Library/Caches/paper-layout-result.json"),
          "utf8",
        ),
      ) as {
        failures: string[];
        checkedLines: number;
      };
      assert.deepEqual(report.failures, []);
      assert.ok(
        report.checkedLines > 100,
        "Must check wrapped lines across multiple paper sizes",
      );
      console.log(
        `Checked ${report.checkedLines} native visible lines without TextKit fallback`,
      );
    } finally {
      spawnSync("xcrun", ["simctl", "uninstall", simulator, bundle], {
        encoding: "utf8",
        timeout: 30_000,
      });
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
