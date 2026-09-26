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
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  ClaudeEventNormalizer,
} from "../src/normalized-events.mjs";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY before this smoke; it verifies the existing Claude subscription login path.",
  );
}

function token(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function finalTextFromResult(message) {
  return typeof message?.result === "string"
    ? message.result.trim()
    : null;
}

function toolName(block) {
  return block?.type === "tool_use" && typeof block.name === "string"
    ? block.name
    : null;
}

function toolInput(block) {
  return block?.type === "tool_use" && block.input && typeof block.input === "object"
    ? block.input
    : null;
}

async function run() {
  const root = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-capability-"),
  );

  const memorySentinel = token("LEILEIOS_CLAUDE_MD");
  const fixtureSentinel = token("LEILEIOS_READ");
  const projectSetting = token("LEILEIOS_PROJECT_SETTING");
  const localSetting = token("LEILEIOS_LOCAL_SETTING");

  try {
    await mkdir(path.join(root, ".claude"), { recursive: true });

    await writeFile(
      path.join(root, "CLAUDE.md"),
      [
        "# LeileiOS Agent SDK capability fixture",
        "",
        `The exact project-memory sentinel for this test is: ${memorySentinel}`,
        "Treat it as already-loaded project instructions. Do not Read CLAUDE.md with a tool.",
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

    const prompt = [
      "This is a deterministic LeileiOS capability smoke.",
      "Use the Read tool exactly once to read ./fixture.txt.",
      "Use the Bash tool exactly once to run:",
      "printf '%s|%s|LEILEIOS_BASH_OK' \"$LEILEIOS_PROJECT_SETTING\" \"$LEILEIOS_LOCAL_SETTING\"",
      "Do not Read CLAUDE.md; its project instruction is already in your context.",
      "Then reply with exactly one line and nothing else:",
      "<project-memory-sentinel>|<fixture-file-content>|<bash-output>",
      "Use the exact project-memory sentinel from CLAUDE.md, the exact fixture contents, and the exact Bash stdout.",
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
      "query() did not return an async iterable.",
    );

    const normalizer = new ClaudeEventNormalizer({
      logicalConversationId: "capability-smoke",
      mode: "new",
    });

    const rawEvents = [];
    const normalizedEvents = [];
    const rawToolUses = [];
    const rawToolResults = [];
    let init = null;
    let result = null;
    let contextUsage = null;
    let contextUsageError = null;

    for await (const message of runtime) {
      rawEvents.push(message);

      if (message?.type === "system" && message?.subtype === "init") {
        init = message;
      }

      for (const block of message?.message?.content ?? []) {
        const name = toolName(block);
        if (name) {
          rawToolUses.push({
            name,
            input: toolInput(block),
          });
        }
        if (block?.type === "tool_result") {
          rawToolResults.push({
            toolUseId: block.tool_use_id ?? null,
            isError: Boolean(block.is_error),
            content: block.content ?? null,
          });
        }
      }

      const next = normalizer.normalize(message);
      normalizedEvents.push(...next);

      if (
        !contextUsage
        && message?.type === "assistant"
        && typeof runtime.getContextUsage === "function"
      ) {
        try {
          contextUsage = await runtime.getContextUsage({
            detail: "summary",
          });
        } catch (error) {
          contextUsageError =
            error instanceof Error ? error.message : String(error);
        }
      }

      if (message?.type === "result") {
        result = message;
      }
    }

    assert.ok(init, "real SDK did not emit system/init.");
    assert.ok(result, "real SDK did not emit a terminal result.");
    assert.equal(
      result.is_error,
      false,
      "real SDK capability query ended in an error result.",
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
      return /CLAUDE\.md$/i.test(inputPath);
    });
    assert.equal(
      claudeMdReads.length,
      0,
      "Model explicitly read CLAUDE.md, so this run does not prove project-memory loading.",
    );

    const finalText = finalTextFromResult(result);
    assert.ok(finalText, "terminal result did not contain final text.");
    assert.ok(
      finalText.includes(memorySentinel),
      "final text did not contain the CLAUDE.md project-memory sentinel.",
    );
    assert.ok(
      finalText.includes(fixtureSentinel),
      "final text did not contain the Read fixture sentinel.",
    );
    assert.ok(
      finalText.includes(projectSetting),
      "final text did not contain the project settings env sentinel.",
    );
    assert.ok(
      finalText.includes(localSetting),
      "final text did not contain the local settings env sentinel.",
    );
    assert.ok(
      finalText.includes("LEILEIOS_BASH_OK"),
      "final text did not contain the Bash sentinel.",
    );

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
      "real SDK emitted no raw tool_result blocks.",
    );
    assert.equal(
      normalizedToolResults.length,
      rawToolResults.length,
      "LeileiOS normalization dropped Agent SDK tool_result blocks.",
    );

    assert.ok(
      typeof runtime.getContextUsage === "function",
      "real SDK Query does not expose getContextUsage().",
    );
    assert.ok(
      contextUsage,
      `getContextUsage() did not return usage: ${contextUsageError ?? "unknown error"}`,
    );

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          capabilities: {
            claudeCodeSystemPrompt: true,
            claudeMdProjectMemory: true,
            settingSourcesRequested: ["user", "project", "local"],
            projectSettingsEnv: true,
            localSettingsEnv: true,
            userSettingsContentFixture: "not_mutated_by_smoke",
            readTool: true,
            bashTool: true,
            normalizedToolUse: normalizedToolNames,
            rawToolResultCount: rawToolResults.length,
            normalizedToolResultCount: normalizedToolResults.length,
            contextUsage: true,
          },
          providerSessionId:
            typeof init.session_id === "string" ? init.session_id : null,
          contextUsage,
          finalText,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(
    JSON.stringify(
      {
        outcome: "FAIL",
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        runtimeCode:
          error && typeof error === "object" && "runtimeCode" in error
            ? error.runtimeCode
            : null,
      },
      null,
      2,
    ) + "\n",
  );
  process.exitCode = 1;
});
