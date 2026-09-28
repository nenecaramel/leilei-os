import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  deleteSession,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import {
  AgentSdkClaudeTransport,
} from "../src/agent-sdk-claude-transport.mjs";
import {
  ClaudeEventNormalizer,
} from "../src/normalized-events.mjs";

if (process.platform !== "darwin") {
  throw new Error(
    "Workspace config convergence smoke must run on macOS.",
  );
}

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY; this smoke verifies existing Claude subscription auth.",
  );
}

function token(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function terminalResult(events) {
  return [...events].reverse().find(
    (event) => event?.type === "result",
  ) ?? null;
}

function finalText(message) {
  return typeof message?.result === "string"
    ? message.result.trim()
    : null;
}

async function run() {
  const root = await mkdtemp(
    path.join(tmpdir(), "leileios-workspace-config-"),
  );

  const memorySentinel = token("LEILEIOS_CLAUDE_MD");
  const fixtureSentinel = token("LEILEIOS_READ");
  const projectSetting = token("LEILEIOS_PROJECT_SETTING");
  const localSetting = token("LEILEIOS_LOCAL_SETTING");

  let transportSessionId = null;
  let directSessionId = null;

  try {
    await mkdir(path.join(root, ".claude"), { recursive: true });

    await writeFile(
      path.join(root, "CLAUDE.md"),
      [
        "# LeileiOS Workspace config convergence fixture",
        "",
        `The exact project-memory sentinel is: ${memorySentinel}`,
        "Treat this as already-loaded project instructions.",
        "Do not Read CLAUDE.md with a tool.",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(root, "fixture.txt"),
      fixtureSentinel + "\n",
      "utf8",
    );

    await writeFile(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify(
        {
          env: {
            LEILEIOS_PROJECT_SETTING: projectSetting,
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await writeFile(
      path.join(root, ".claude", "settings.local.json"),
      JSON.stringify(
        {
          env: {
            LEILEIOS_LOCAL_SETTING: localSetting,
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    // Stage A: exercise the actual LeileiOS transport against the same cwd.
    const transport = new AgentSdkClaudeTransport({
      cwd: root,
      environment: process.env,
    });
    const transportResult = await transport.sendNew(
      [
        "This is a deterministic LeileiOS Workspace-config smoke.",
        "Do not use tools.",
        "Reply with exactly the project-memory sentinel from CLAUDE.md and nothing else.",
      ].join("\n"),
    );
    transportSessionId = transportResult.providerSessionId;

    const transportTerminal = terminalResult(
      transportResult.events ?? [],
    );
    assert.ok(
      transportTerminal,
      "LeileiOS transport did not emit a terminal result.",
    );
    assert.equal(
      transportTerminal.is_error,
      false,
      "LeileiOS transport ended in an error result.",
    );
    assert.equal(
      finalText(transportTerminal),
      memorySentinel,
      "LeileiOS transport did not inherit CLAUDE.md from the bound cwd.",
    );

    // Stage B: verify the exact Claude project/local setting sources used by
    // the LeileiOS transport actually resolve in the same directory.
    const prompt = [
      "This is a deterministic LeileiOS Workspace-config smoke.",
      "Use the Read tool exactly once to read ./fixture.txt.",
      "Use the Bash tool exactly once to run:",
      "printf '%s|%s|LEILEIOS_BASH_OK' \"$LEILEIOS_PROJECT_SETTING\" \"$LEILEIOS_LOCAL_SETTING\"",
      "Do not Read CLAUDE.md; its project instruction is already in context.",
      "Then reply with exactly one line and nothing else:",
      "<project-memory-sentinel>|<fixture-file-content>|<bash-output>",
    ].join("\n");

    const runtime = query({
      prompt,
      options: {
        cwd: root,
        env: process.env,
        settingSources: ["user", "project", "local"],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
        },
        verbatimPrompts: true,
        allowedTools: ["Read", "Bash"],
      },
    });

    assert.equal(
      typeof runtime?.[Symbol.asyncIterator],
      "function",
      "Agent SDK query() did not return an async iterable.",
    );

    const normalizer = new ClaudeEventNormalizer({
      logicalConversationId: "workspace-config-smoke",
      mode: "new",
    });

    const rawToolUses = [];
    const rawToolResults = [];
    const normalizedEvents = [];
    let init = null;
    let result = null;

    for await (const message of runtime) {
      if (
        message?.type === "system"
        && message?.subtype === "init"
      ) {
        init = message;
        if (typeof message.session_id === "string") {
          directSessionId = message.session_id;
        }
      }

      for (const block of message?.message?.content ?? []) {
        if (
          block?.type === "tool_use"
          && typeof block.name === "string"
        ) {
          rawToolUses.push({
            name: block.name,
            input:
              block.input
              && typeof block.input === "object"
                ? block.input
                : null,
          });
        }
        if (block?.type === "tool_result") {
          rawToolResults.push(block);
        }
      }

      normalizedEvents.push(...normalizer.normalize(message));

      if (message?.type === "result") {
        result = message;
      }
    }

    assert.ok(init, "Agent SDK did not emit system/init.");
    assert.ok(result, "Agent SDK did not emit a terminal result.");
    assert.equal(
      result.is_error,
      false,
      "Agent SDK config smoke ended in an error result.",
    );

    const names = rawToolUses.map((entry) => entry.name);
    assert.ok(names.includes("Read"), "Read tool_use was not observed.");
    assert.ok(names.includes("Bash"), "Bash tool_use was not observed.");

    const claudeMdReads = rawToolUses.filter((entry) => {
      if (entry.name !== "Read") return false;
      const inputPath =
        typeof entry.input?.file_path === "string"
          ? entry.input.file_path
          : typeof entry.input?.path === "string"
            ? entry.input.path
            : "";
      return /CLAUDE\.md$/iu.test(inputPath);
    });
    assert.equal(
      claudeMdReads.length,
      0,
      "Model explicitly read CLAUDE.md; project-memory auto-loading was not proven.",
    );

    const text = finalText(result);
    assert.ok(text, "Agent SDK result did not contain final text.");
    for (const sentinel of [
      memorySentinel,
      fixtureSentinel,
      projectSetting,
      localSetting,
      "LEILEIOS_BASH_OK",
    ]) {
      assert.ok(
        text.includes(sentinel),
        `Agent SDK final text is missing ${sentinel}.`,
      );
    }

    const normalizedToolNames = normalizedEvents
      .filter((event) => event.type === "tool_use")
      .map((event) => event.payload?.tool_name)
      .filter(Boolean);
    assert.ok(
      normalizedToolNames.includes("Read"),
      "Read tool_use did not survive LeileiOS normalization.",
    );
    assert.ok(
      normalizedToolNames.includes("Bash"),
      "Bash tool_use did not survive LeileiOS normalization.",
    );

    const normalizedToolResults = normalizedEvents.filter(
      (event) => event.type === "tool_result",
    );
    assert.ok(
      rawToolResults.length > 0,
      "Agent SDK emitted no raw tool_result blocks.",
    );
    assert.equal(
      normalizedToolResults.length,
      rawToolResults.length,
      "LeileiOS normalization dropped Agent SDK tool_result blocks.",
    );

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          workspaceRoot: root,
          leileiTransport: {
            cwdProjectMemory: true,
            providerSessionId: transportSessionId,
          },
          claudeProjectConfig: {
            claudeMdProjectMemory: true,
            settingSources: ["user", "project", "local"],
            projectSettingsEnv: true,
            localSettingsEnv: true,
            readTool: true,
            bashTool: true,
            normalizedToolResultParity: true,
          },
          providerSessionId: directSessionId,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    if (transportSessionId) {
      try {
        const cleanup = new AgentSdkClaudeTransport({
          cwd: root,
          environment: process.env,
        });
        await cleanup.deleteSession(transportSessionId);
      } catch {}
    }
    if (directSessionId) {
      try {
        await deleteSession(directSessionId, { dir: root });
      } catch {}
    }
    await rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(
    JSON.stringify(
      {
        outcome: "FAIL",
        name:
          error instanceof Error
            ? error.name
            : "UnknownError",
        message:
          error instanceof Error
            ? error.message
            : String(error),
        runtimeCode:
          error
          && typeof error === "object"
          && "runtimeCode" in error
            ? error.runtimeCode
            : null,
      },
      null,
      2,
    ) + "\n",
  );
  process.exitCode = 1;
});
