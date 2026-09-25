import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
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

function toolUses(result) {
  return result.normalizedEvents
    .filter((event) => event.type === "tool_use")
    .map((event) => ({
      name: event.payload?.tool_name,
      input: event.payload?.input,
    }))
    .filter((value) => typeof value.name === "string");
}

async function resolveRequestedPath(root, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const resolved = path.isAbsolute(value)
    ? value
    : path.resolve(root, value);
  try {
    const canonicalParent =
      await realpath(path.dirname(resolved));
    return path.join(
      canonicalParent,
      path.basename(resolved),
    );
  } catch {
    return null;
  }
}

function createFilesystemPermissionHandler({
  root,
  parityPath,
  findCommand,
  grepCommand,
  requests,
}) {
  return async (request) => {
    requests.push({
      toolName: request.toolName,
      input: request.input,
    });

    if (request.toolName === "Skill") {
      return { decision: "allow" };
    }

    if (
      request.toolName === "Write"
      || request.toolName === "Edit"
    ) {
      const requestedPath =
        await resolveRequestedPath(
          root,
          request.input?.file_path
            ?? request.input?.path,
        );
      const allowedPath =
        await resolveRequestedPath(
          root,
          parityPath,
        );
      if (
        requestedPath
        && allowedPath
        && requestedPath === allowedPath
      ) {
        return { decision: "allow" };
      }
    }

    if (
      request.toolName === "Bash"
      && (
        request.input?.command === findCommand
        || request.input?.command === grepCommand
      )
    ) {
      return { decision: "allow" };
    }

    return {
      decision: "deny",
      message:
        "LEILEIOS_FILESYSTEM_PARITY_SCOPE_DENIED",
      interrupt: false,
    };
  };
}

async function run() {
  const root = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-filesystem-parity-"),
  );
  const skillSentinel = token("LEILEIOS_SKILL");
  const agentSentinel = token("LEILEIOS_SUBAGENT");
  const writeSentinel = token("LEILEIOS_WRITE");
  const editSentinel = token("LEILEIOS_EDIT");
  const parityPath =
    path.join(root, "workspace", "parity.txt");
  const findCommand =
    "find ./workspace -name 'parity.txt'";
  const grepCommand =
    `grep -F '${editSentinel}' ./workspace/parity.txt`;
  const filesystemPermissionRequests = [];

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

    let filesystemInit = null;
    const onFilesystemRaw = (event) => {
      if (event?.type === "system" && event?.subtype === "init") {
        filesystemInit = event;
      }
    };
    transport.events.on("event", onFilesystemRaw);

    const filesystem = await transport.executeTurn(
      [
        "This is a deterministic LeileiOS Agent SDK filesystem parity smoke.",
        "Use the project skill named leileios-parity to learn the exact skill sentinel.",
        `Use Write to create ./workspace/parity.txt with exactly: ${writeSentinel}`,
        `Use Edit to replace that exact text with exactly: ${editSentinel}`,
        "Inspect the available tools from this native SDK session before searching.",
        "If dedicated Glob and Grep are available, use Glob to find ./workspace/*.txt and Grep to search ./workspace for the exact edited text.",
        `If dedicated Glob/Grep are not available, use Bash for the two search operations with exactly these commands, separately and without wrappers: ${findCommand} ; ${grepCommand}`,
        "Do not use Bash for the Write or Edit operations.",
        "After the required tools complete, reply with exactly the skill sentinel and nothing else.",
      ].join("\n"),
      {
        streaming: false,
        permissionHandler:
          createFilesystemPermissionHandler({
            root,
            parityPath,
            findCommand,
            grepCommand,
            requests:
              filesystemPermissionRequests,
          }),
      },
    );
    transport.events.off("event", onFilesystemRaw);

    assert.ok(filesystemInit, "real SDK emitted no system/init event.");
    assert.ok(
      Array.isArray(filesystemInit.skills)
      && filesystemInit.skills.includes("leileios-parity"),
      `project Skill was not advertised in init: ${JSON.stringify(filesystemInit.skills)}`,
    );
    for (const required of ["Write", "Edit", "Skill"]) {
      assert.ok(
        Array.isArray(filesystemInit.tools)
        && filesystemInit.tools.includes(required),
        `init did not expose built-in ${required}: ${JSON.stringify(filesystemInit.tools)}`,
      );
    }

    const dedicatedSearch =
      filesystemInit.tools.includes("Glob")
      && filesystemInit.tools.includes("Grep");
    const nativeBashSearch =
      !dedicatedSearch && filesystemInit.tools.includes("Bash");
    assert.ok(
      dedicatedSearch || nativeBashSearch,
      `init exposed neither dedicated Glob/Grep nor native Bash search: ${JSON.stringify(filesystemInit.tools)}`,
    );

    assert.equal(
      finalText(filesystem),
      skillSentinel,
      "project Skill did not supply the exact hidden sentinel.",
    );

    const names = toolNames(filesystem);
    const uses = toolUses(filesystem);
    for (const required of ["Write", "Edit"]) {
      assert.ok(
        names.includes(required),
        `required built-in tool ${required} was not observed: ${JSON.stringify(names)}`,
      );
    }

    if (dedicatedSearch) {
      for (const required of ["Glob", "Grep"]) {
        assert.ok(
          names.includes(required),
          `dedicated search tool ${required} was not observed: ${JSON.stringify(names)}`,
        );
      }
    } else {
      const bashCommands = uses
        .filter((use) => use.name === "Bash")
        .map((use) => use.input?.command)
        .filter((value) => typeof value === "string");
      assert.ok(
        bashCommands.some((command) => /\bfind\b/u.test(command)),
        `native search did not exercise find through Bash: ${JSON.stringify(bashCommands)}`,
      );
      assert.ok(
        bashCommands.some((command) => /\bgrep\b/u.test(command)),
        `native search did not exercise grep through Bash: ${JSON.stringify(bashCommands)}`,
      );
    }

    assert.equal(
      (
        await readFile(
          parityPath,
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

    let subagentInit = null;
    const onSubagentRaw = (event) => {
      if (event?.type === "system" && event?.subtype === "init") {
        subagentInit = event;
      }
    };
    transport.events.on("event", onSubagentRaw);

    const subagent = await transport.sendNew(
      [
        "This is the LeileiOS subagent parity smoke.",
        "Delegate exactly one task to the project subagent named leileios-parity-agent.",
        "Ask that subagent for its private parity sentinel.",
        "Do not inspect .claude/agents files yourself.",
        "Return exactly the subagent's sentinel and nothing else.",
      ].join("\n"),
    );
    transport.events.off("event", onSubagentRaw);

    assert.ok(subagentInit, "subagent turn emitted no system/init event.");
    assert.ok(
      Array.isArray(subagentInit.agents)
      && subagentInit.agents.includes("leileios-parity-agent"),
      `project subagent was not advertised in init: ${JSON.stringify(subagentInit.agents)}`,
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
            filesystemSearch: dedicatedSearch ? "dedicated_glob_grep" : "native_bash_find_grep",
            localPostToolUseHook: true,
            projectSubagent: true,
          },
          filesystemToolNames: names,
          filesystemSearchMode:
            dedicatedSearch ? "dedicated_glob_grep" : "native_bash_find_grep",
          filesystemPermissionRequests:
            filesystemPermissionRequests.map(
              (request) => request.toolName,
            ),
          subagentToolNames: subagentTools,
          hookEvents,
          init: {
            skills: filesystemInit.skills,
            agents: subagentInit.agents,
          },
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
