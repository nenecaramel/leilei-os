import assert from "node:assert/strict";
import test from "node:test";
import {
  pickNativeLiveMacWorkspaceRoot,
  type NativeLiveMacWorkspacePickerCommandResult,
} from "../src/domains/bridge/native-live-mac-workspace-picker.js";

test("Workspace picker uses the native macOS folder dialog and returns its POSIX path", () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const selected = pickNativeLiveMacWorkspaceRoot({
    platform: "darwin",
    prompt: "Pick LeileiOS project",
    run: (command, args) => {
      calls.push({ command, args });
      return {
        status: 0,
        stdout: "/Users/leilei/Projects/leilei-os/\n",
        stderr: "",
      };
    },
  });

  assert.equal(selected, "/Users/leilei/Projects/leilei-os/");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "/usr/bin/osascript");
  assert.equal(calls[0]?.args[0], "-e");
  assert.match(
    calls[0]?.args[1] ?? "",
    /choose folder with prompt/u,
  );
  assert.match(
    calls[0]?.args[1] ?? "",
    /return POSIX path of selectedFolder/u,
  );
});

test("Workspace picker cancellation is observable and does not invent a path", () => {
  const result: NativeLiveMacWorkspacePickerCommandResult = {
    status: 1,
    stdout: "",
    stderr: "execution error: User canceled. (-128)",
  };
  assert.equal(
    pickNativeLiveMacWorkspaceRoot({
      platform: "darwin",
      run: () => result,
    }),
    null,
  );
});

test("Workspace picker rejects non-macOS hosts before starting a command", () => {
  let calls = 0;
  assert.throws(
    () => pickNativeLiveMacWorkspaceRoot({
      platform: "linux",
      run: () => {
        calls += 1;
        return {
          status: 0,
          stdout: "/tmp/project",
          stderr: "",
        };
      },
    }),
    /only on macOS/u,
  );
  assert.equal(calls, 0);
});

test("Workspace picker fails closed on native command failure and blank output", () => {
  assert.throws(
    () => pickNativeLiveMacWorkspaceRoot({
      platform: "darwin",
      run: () => ({
        status: 2,
        stdout: "",
        stderr: "unexpected failure",
      }),
    }),
    /folder picker failed/u,
  );

  assert.throws(
    () => pickNativeLiveMacWorkspaceRoot({
      platform: "darwin",
      run: () => ({
        status: 0,
        stdout: "  \n",
        stderr: "",
      }),
    }),
    /returned no directory/u,
  );
});
