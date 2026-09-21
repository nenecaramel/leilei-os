import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { ClaudeTransport } from "./claude-transport.mjs";
import { ClaudeEventNormalizer } from "./normalized-events.mjs";

function streamError(message, details) {
  return Object.assign(new Error(message), details);
}

/** Local subscription-auth Claude Code transport; it never calls the Messages API. */
export class HeadlessClaudeTransport extends ClaudeTransport {
  constructor({ spawn = nodeSpawn, command = "claude", environment = process.env } = {}) {
    super();
    if (environment.ANTHROPIC_API_KEY) {
      throw new Error("Refusing HeadlessClaudeTransport: ANTHROPIC_API_KEY must not be set.");
    }
    this.spawn = spawn;
    this.command = command;
    this.environment = environment;
    this.events = new EventEmitter();
    this.activeChild = null;
  }

  sendNew(prompt) {
    return this.#run(["-p", prompt, "--output-format=stream-json", "--verbose"], { mode: "new" });
  }

  resume(sessionId, prompt) {
    return this.#run(["-p", prompt, "--resume", sessionId, "--output-format=stream-json", "--verbose"], { mode: "resume", parentProviderSessionId: sessionId });
  }

  async fork(sessionId, prompt) {
    const result = await this.#run(["-p", prompt, "--resume", sessionId, "--fork-session", "--output-format=stream-json", "--verbose"], { mode: "fork", parentProviderSessionId: sessionId });
    if (!result.providerSessionId || result.providerSessionId === sessionId) {
      throw streamError("Claude fork returned the same provider session id as its parent.", { parentSessionId: sessionId, forkSessionId: result.providerSessionId, ...result });
    }
    return result;
  }

  abort() {
    if (this.activeChild && !this.activeChild.killed) this.activeChild.kill("SIGTERM");
  }

  #run(args, normalization = { mode: "new" }) {
    return new Promise((resolve, reject) => {
      const child = this.spawn(this.command, args, { env: this.environment, stdio: ["ignore", "pipe", "pipe"] });
      this.activeChild = child;
      let stdout = "";
      let stderr = "";
      let pending = "";
      let providerSessionId = null;
      const parsedEvents = [];
      const normalizedEvents = [];
      const normalizer = new ClaudeEventNormalizer({ logicalConversationId: null, ...normalization });
      let parseFailure = null;

      const consumeLine = (line) => {
        if (!line) return;
        let event;
        try { event = JSON.parse(line); }
        catch (cause) {
          parseFailure ??= streamError("Claude stream emitted malformed JSON.", { cause, line });
          this.events.emit("parse-error", parseFailure);
          return;
        }
        parsedEvents.push(event);
        if (!providerSessionId && typeof event.session_id === "string") providerSessionId = event.session_id;
        if (!providerSessionId && typeof event.sessionId === "string") providerSessionId = event.sessionId;
        this.events.emit("event", event);
        const nextNormalizedEvents = normalizer.normalize(event);
        normalizedEvents.push(...nextNormalizedEvents);
        for (const normalizedEvent of nextNormalizedEvents) {
          this.events.emit("normalized-event", normalizedEvent);
        }
      };

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); this.events.emit("stderr", chunk.toString()); });
      child.on("error", (cause) => reject(streamError(`Failed to start Claude Code: ${cause.message}`, { cause, stdout, stderr })));
      child.on("close", (code, signal) => {
        if (pending) consumeLine(pending);
        this.activeChild = null;
        if (parseFailure) { reject(Object.assign(parseFailure, { stdout, stderr, exitCode: code, signal })); return; }
        if (code !== 0) { reject(streamError(`Claude Code exited with exit code ${code}: ${stderr.trim() || "no stderr"}`, { stdout, stderr, exitCode: code, signal })); return; }
        this.events.emit("exit", { code, signal, stdout, stderr });
        resolve({ providerSessionId, events: parsedEvents, normalizedEvents, stdout, stderr, exitCode: code, signal });
      });
    });
  }
}
