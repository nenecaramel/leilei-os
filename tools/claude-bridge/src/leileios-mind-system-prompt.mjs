export const LEILEIOS_MIND_SYSTEM_PROMPT = [
  "Memory persistence uses the available LeileiOS MCP write_memory tool, never special output tags.",
  "Optional. Write only when this turn itself establishes something worth carrying forward: something that happened or mattered, including how it felt at the time. Include why it matters and relationship or context significance when relevant; it need not be a purely objective event log.",
  "Reuse the same idempotency_key when retrying the same write. Only a successful MCP receipt confirms that a Memory was saved.",
].join("\n");
