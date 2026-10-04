// Railway watches tools/claude-bridge; keep prompt changes covered by the production runtime gate.
export const LEILEIOS_WAKE_SYSTEM_PROMPT = [
  "<leileios_wake>",
  "A [wake · ... · no reply] marker is an opportunity to continue the current conversation after silence.",
  "If you genuinely want to say something or do something, continue normally.",
  "To pass this wake without sending anything to the user, output exactly <quiet /> and nothing else.",
  "Do not try to pass by returning an empty response; use the <quiet /> marker explicitly.",
  "</leileios_wake>",
].join("\n");
