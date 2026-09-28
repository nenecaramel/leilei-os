import { spawnSync } from "node:child_process";

export type NativeLiveMacWorkspacePickerCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type NativeLiveMacWorkspacePickerRunner = (
  command: string,
  args: readonly string[],
) => NativeLiveMacWorkspacePickerCommandResult;

const DEFAULT_PROMPT = "Select the local folder for this LeileiOS Workspace";

export function pickNativeLiveMacWorkspaceRoot(input: {
  platform?: NodeJS.Platform;
  prompt?: string;
  run?: NativeLiveMacWorkspacePickerRunner;
} = {}): string | null {
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error(
      "Native Live Workspace folder picker is available only on macOS.",
    );
  }

  const prompt = normalizePrompt(input.prompt ?? DEFAULT_PROMPT);
  const run = input.run ?? defaultRunner;
  const result = run("/usr/bin/osascript", [
    "-e",
    [
      "set selectedFolder to choose folder with prompt ",
      appleScriptString(prompt),
      "return POSIX path of selectedFolder",
    ].join("\n"),
  ]);

  if (isCancelled(result)) return null;

  if (result.error || result.status !== 0) {
    throw new Error(
      "Native Live Workspace folder picker failed.",
      result.error ? { cause: result.error } : undefined,
    );
  }

  const selected = result.stdout.trim();
  if (!selected) {
    throw new Error(
      "Native Live Workspace folder picker returned no directory.",
    );
  }
  return selected;
}

function defaultRunner(
  command: string,
  args: readonly string[],
): NativeLiveMacWorkspacePickerCommandResult {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function normalizePrompt(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new Error(
      "Native Live Workspace folder picker prompt is invalid.",
    );
  }
  return normalized;
}

function appleScriptString(value: string): string {
  return JSON.stringify(value);
}

function isCancelled(
  result: NativeLiveMacWorkspacePickerCommandResult,
): boolean {
  if (result.status === 0) return false;
  return /user canceled|\(-128\)/iu.test(result.stderr);
}
