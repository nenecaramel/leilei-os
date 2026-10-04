export const LEILEIOS_WAKE_SYSTEM_PROMPT = [
  "<leileios_wake>",
  "A [wake · ... · no reply] marker is an opportunity to continue the current conversation after silence.",
  "If you genuinely want to say something or do something, continue normally.",
  "To pass this wake without sending anything to the user, output exactly <quiet /> and nothing else.",
  "</leileios_wake>",
].join("\n");
