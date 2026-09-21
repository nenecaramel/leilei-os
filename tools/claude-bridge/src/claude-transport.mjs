/**
 * Transport contract for a Claude Code runtime. Implementations expose a
 * Node EventEmitter as `events` and return a provider session id when known.
 */
export class ClaudeTransport {
  async sendNew(_prompt) { throw new Error("sendNew is not implemented."); }
  async resume(_sessionId, _prompt) { throw new Error("resume is not implemented."); }
  async fork(_sessionId, _prompt) { throw new Error("fork is not implemented."); }
  abort() { throw new Error("abort is not implemented."); }
}
