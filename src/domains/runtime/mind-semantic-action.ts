export type MindSatisfactionLevel = "partial" | "full";

export type MindSemanticAction =
  | {
      kind: "mind_satisfy";
      stateId: string;
      level: MindSatisfactionLevel;
      sourceStart: number;
      sourceEnd: number;
      raw: string;
    }
  | {
      kind: "mind_resolve";
      stateId: string;
      sourceStart: number;
      sourceEnd: number;
      raw: string;
    };

export type ParsedMindSemanticActions = {
  visibleText: string;
  actions: MindSemanticAction[];
};

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ACTION_PATTERN = new RegExp(
  `<mind_satisfy\\s+state_id="(${UUID})"\\s+level="(partial|full)"\\s*\\/>|<mind_resolve\\s+state_id="(${UUID})"\\s*\\/>`,
  "gi",
);

/**
 * Parses only strict self-closing semantic action directives.
 *
 * Malformed or unsupported directives remain visible text. This keeps parser
 * failure fail-closed: prose cannot silently mutate Mind.
 */
export function parseMindSemanticActions(
  source: string,
): ParsedMindSemanticActions {
  const actions: MindSemanticAction[] = [];
  const removable: Array<{ start: number; end: number }> = [];

  for (const match of source.matchAll(ACTION_PATTERN)) {
    const raw = match[0];
    const start = match.index;
    if (start === undefined) continue;

    const satisfyStateId = match[1]?.toLowerCase();
    const level = match[2]?.toLowerCase() as MindSatisfactionLevel | undefined;
    const resolveStateId = match[3]?.toLowerCase();
    const end = start + raw.length;

    if (satisfyStateId && level) {
      actions.push({
        kind: "mind_satisfy",
        stateId: satisfyStateId,
        level,
        sourceStart: start,
        sourceEnd: end,
        raw,
      });
      removable.push({ start, end });
      continue;
    }
    if (resolveStateId) {
      actions.push({
        kind: "mind_resolve",
        stateId: resolveStateId,
        sourceStart: start,
        sourceEnd: end,
        raw,
      });
      removable.push({ start, end });
    }
  }

  let visibleText = source;
  for (const range of removable.sort((a, b) => b.start - a.start)) {
    visibleText =
      visibleText.slice(0, range.start)
      + visibleText.slice(range.end);
  }

  return {
    visibleText: visibleText
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    actions,
  };
}
