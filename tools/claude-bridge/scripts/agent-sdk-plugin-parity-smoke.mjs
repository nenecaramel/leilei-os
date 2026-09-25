import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  query,
} from "@anthropic-ai/claude-agent-sdk";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY; this smoke verifies the existing Claude subscription login.",
  );
}

const pluginName = "leileios-parity-plugin";
const skillName = "leileios-plugin-parity";

function assistantToolNames(message) {
  if (message?.type !== "assistant") return [];
  return (message.message?.content ?? [])
    .filter((block) => block?.type === "tool_use")
    .map((block) => block.name)
    .filter((value) => typeof value === "string");
}

async function run() {
  const root = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-plugin-parity-"),
  );
  const pluginRoot = path.join(root, pluginName);
  const sentinel =
    "LEILEIOS_PLUGIN_" + randomUUID().replaceAll("-", "").slice(0, 16);

  try {
    await mkdir(
      path.join(pluginRoot, ".claude-plugin"),
      { recursive: true },
    );
    await mkdir(
      path.join(pluginRoot, "skills", skillName),
      { recursive: true },
    );

    await writeFile(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: pluginName,
        version: "1.0.0",
        description:
          "Disposable local plugin for LeileiOS Agent SDK parity acceptance.",
      }, null, 2) + "\n",
      "utf8",
    );

    await writeFile(
      path.join(pluginRoot, "skills", skillName, "SKILL.md"),
      [
        "---",
        "name: " + skillName,
        "description: Use this skill whenever the user asks for the LeileiOS plugin parity sentinel.",
        "---",
        "",
        "# LeileiOS plugin parity",
        "",
        "The exact hidden plugin sentinel is:",
        sentinel,
        "",
        "When asked for the plugin parity sentinel, return exactly that value and nothing else.",
        "",
      ].join("\n"),
      "utf8",
    );

    const messages = [];
    let init = null;

    for await (const message of query({
      prompt: [
        "This is a deterministic LeileiOS Agent SDK local-plugin parity smoke.",
        "Use the plugin skill named " + pluginName + ":" + skillName + " to learn the hidden plugin sentinel.",
        "Do not inspect the plugin files directly and do not guess the sentinel.",
        "Reply with exactly the sentinel and nothing else.",
      ].join("\n"),
      options: {
        cwd: root,
        env: process.env,
        settingSources: ["user", "project", "local"],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
        },
        plugins: [{
          type: "local",
          path: pluginRoot,
        }],
        allowedTools: ["Skill"],
      },
    })) {
      messages.push(message);
      if (message?.type === "system" && message?.subtype === "init") {
        init = message;
      }
    }

    assert.ok(init, "real SDK emitted no system/init event.");

    const loadedPluginNames = Array.isArray(init.plugins)
      ? init.plugins
          .map((plugin) =>
            typeof plugin === "string"
              ? plugin
              : plugin?.name,
          )
          .filter((value) => typeof value === "string")
      : [];
    assert.ok(
      loadedPluginNames.includes(pluginName),
      "local plugin was not advertised in system/init.",
    );

    const qualifiedSkill = pluginName + ":" + skillName;
    assert.ok(
      Array.isArray(init.skills)
      && init.skills.includes(qualifiedSkill),
      "plugin skill was not advertised with its namespace.",
    );

    const toolNames = messages.flatMap(assistantToolNames);
    assert.ok(
      toolNames.includes("Skill"),
      "SDK stream did not expose a structured Skill invocation.",
    );

    const result = [...messages]
      .reverse()
      .find((message) => message?.type === "result");
    assert.ok(result, "SDK stream emitted no terminal result.");
    assert.equal(
      result.result?.trim(),
      sentinel,
      "plugin skill did not supply the exact hidden sentinel.",
    );

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          capability: "local_plugin_skill",
          pluginName,
          qualifiedSkill,
          observedToolNames: toolNames,
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
      },
      null,
      2,
    ) + "\n",
  );
  process.exitCode = 1;
});
