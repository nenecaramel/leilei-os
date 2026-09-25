import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  AgentSdkClaudeTransport,
} from "../src/agent-sdk-claude-transport.mjs";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY; this smoke verifies the existing Claude subscription login.",
  );
}

function token(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function finalText(result) {
  const event = [...result.normalizedEvents]
    .reverse()
    .find((candidate) => candidate.type === "result");
  return typeof event?.payload?.final_text === "string"
    ? event.payload.final_text.trim()
    : null;
}

function toolNames(result) {
  return result.normalizedEvents
    .filter((event) => event.type === "tool_use")
    .map((event) => event.payload?.tool_name)
    .filter((value) => typeof value === "string");
}

async function run() {
  const root = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-filesystem-parity-"),
  );
  const skillSentinel = token("LEILEIOS_SKILL");
  const agentSentinel = token("LEILEIOS_SUBAGENT");
  const writeSentinel = token("LEILEIOS_WRITE");
  const editSentinel = token("LEILEIOS_EDIT");

  try {
    await mkdir(path.join(root, ".claude", "skills", "leileios-parity"), {
      recursive: true,
    });
    await mkdir(path.join(root, ".claude", "agents"), {
      recursive: true,
    });
    await mkdir(path.join(root, ".claude", "hooks"), {
      recursive: true,
    });
    await mkdir(path.join(root, "workspace"), {
      recursive: true,
    });

    await writeFile(
      path.join(root, ".claude", "skills", "leileios-parity", "SKILL.md"),
      [
        "---",
        "name: leileios-parity",
        "description: Use this project skill whenever the user asks for the LeileiOS filesystem parity sentinel.",
        "---",
        "",
        "# LeileiOS parity skill",
        "",
        `The exact skill sentinel is: ${skillSentinel}`,
        "When asked for the parity sentinel, return this exact value.",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(root, ".claude", "agents", "leileios-parity-agent.md"),
      [
        "---",
        "name: leileios-parity-agent",
        "description: A deterministic subagent used only by the LeileiOS Agent SDK parity smoke.",
        "tools: Read",
        "---",
        "",
        "# LeileiOS parity subagent",
        "",
        `Your exact private sentinel is: ${agentSentinel}`,
        "When delegated the parity-sentinel task, return only that sentinel.",
        "",
      ].join("\n"),
      "utf8",
    );

    const hookPath =
      path.join(root, ".claude", "hooks", "record-tool.mjs");
    await writeFile(
      hookPath,
      [
        'import { appendFile } from "node:fs/promises";',
        'import path from "node:path";',
        'let input = "";',
        'for await (const chunk of process.stdin) input += chunk;',
        'let parsed = {};',
        'try { parsed = JSON.parse(input); } catch {}',
        'const name = parsed?.tool_name ?? parsed?.toolName ?? "unknown";',
        'await appendFile(path.join(process.cwd(), "hook-events.log"), String(name) + "\\n", "utf8");',
      ].join("\n"),
      "utf8",
    );
    await chmod(hookPath, 0o755);

    await writeFile(
      path.join(root, ".claude", "settings.local.json"),
      JSON.stringify(
        {
          hooks: {
            PostToolUse: [
              {
                matcher: "Write|Edit",
                hooks: [
                  {
                    type: "command",
                    command:
                      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/record-tool.mjs"',
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const transport = new AgentSdkClaudeTransport({
      cwd: root,
      environment: process.env,
    });

    const filesystem = await transport.sendNew(
      [
        "This is a deterministic LeileiOS Agent SDK filesystem parity smoke.",
        "Use the project skill named leileios-parity to learn the exact skill sentinel.",
        `Use Write to create ./workspace/parity.txt with exactly: ${writeSentinel}`,
        `Use Edit to replace that exact text with exactly: ${editSentinel}`,
        "Use Glob to find ./workspace/*.txt.",
        `Use Grep to search ./workspace for the exact edited text ${editSentinel}.`,
        "Do not use Bash to perform any of those four file operations.",
        "After the required tools complete, reply with exactly the skill sentinel and nothing else.",
      ].join("\n"),
    );

    assert.equal(
      finalText(filesystem),
      skillSentinel,
      "project Skill did not supply the exact hidden sentinel.",
    );

    const names = toolNames(filesystem);
    for (const required of ["Write", "Edit", "Glob", "Grep"]) {
      assert.ok(
        names.includes(required),
        `required built-in tool ${required} was not observed: ${JSON.stringify(names)}`,
      );
    }

    assert.equal(
      (
        await readFile(
          path.join(root, "workspace", "parity.txt"),
          "utf8",
        )
      ).trim(),
      editSentinel,
      "Write/Edit did not leave the expected final bytes.",
    );

    const hookEvents = (
      await readFile(path.join(root, "hook-events.log"), "utf8")
    )
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean);
    assert.ok(
      hookEvents.includes("Write"),
      `PostToolUse hook did not record Write: ${JSON.stringify(hookEvents)}`,
    );
    assert.ok(
      hookEvents.includes("Edit"),
      `PostToolUse hook did not record Edit: ${JSON.stringify(hookEvents)}`,
    );

    const subagent = await transport.sendNew(
      [
        "This is the LeileiOS subagent parity smoke.",
        "Delegate exactly one task to the project subagent named leileios-parity-agent.",
        "Ask that subagent for its private parity sentinel.",
        "Do not inspect .claude/agents files yourself.",
        "Return exactly the subagent's sentinel and nothing else.",
      ].join("\n"),
    );

    assert.equal(
      finalText(subagent),
      agentSentinel,
      "project subagent did not return the exact hidden sentinel.",
    );

    const subagentTools = toolNames(subagent);
    assert.ok(
      subagentTools.some(
        (name) =>
          name === "Task"
          || name === "Agent"
          || name === "Workflow",
      ),
      `no structured subagent tool event was observed: ${JSON.stringify(subagentTools)}`,
    );

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          capabilities: {
            projectSkill: true,
            write: true,
            edit: true,
            glob: true,
            grep: true,
            localPostToolUseHook: true,
            projectSubagent: true,
          },
          filesystemToolNames: names,
          subagentToolNames: subagentTools,
          hookEvents,
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
