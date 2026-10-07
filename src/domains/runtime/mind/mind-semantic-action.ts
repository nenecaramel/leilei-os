// No current Mind mutation directives. Keep the parser boundary so pre-deployment
// assistant text remains opaque and never changes persistent state.
export type MindSemanticAction = never;
export type ParsedMindSemanticActions = { visibleText: string; actions: MindSemanticAction[] };
export function parseMindSemanticActions(source: string): ParsedMindSemanticActions {
  return { visibleText: source, actions: [] };
}
