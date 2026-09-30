import {
  normalizeMindVisibleText,
  overlapsMindProtectedRange,
  retiredMindProtectedRanges,
} from "./mind-protected-ranges.js";

/**
 * The only semantic action: let a current thought go.
 *
 * The model never sees database ids. Each turn's context labels the active
 * thoughts T1, T2, T3; the manifest keeps the mapping from label to state id,
 * and the action executor resolves `ref` through that manifest.
 */
export type MindSemanticAction = {
  kind: "thought_drop";
  ref: string;
  sourceStart: number;
  sourceEnd: number;
  raw: string;
};

export type ParsedMindSemanticActions = {
  visibleText: string;
  actions: MindSemanticAction[];
};

export const THOUGHT_REF_PATTERN = /^T[1-9][0-9]?$/;

const ACTION_PATTERN = /<thought_drop\s+ref="(T[1-9][0-9]?)"\s*\/>/gi;

/**
 * Parses only strict self-closing directives.
 *
 * Malformed or unsupported directives remain visible text. This keeps parser
 * failure fail-closed: prose cannot silently mutate Mind.
 */
export function parseMindSemanticActions(
  source: string,
): ParsedMindSemanticActions {
  const actions: MindSemanticAction[] = [];
  const removable: Array<{ start: number; end: number }> = [];
  const protectedRanges = retiredMindProtectedRanges(source);

  for (const match of source.matchAll(ACTION_PATTERN)) {
    const raw = match[0];
    const start = match.index;
    const ref = match[1]?.toUpperCase();
    if (start === undefined || !ref) continue;

    const end = start + raw.length;
    if (overlapsMindProtectedRange(protectedRanges, start, end)) continue;
    actions.push({
      kind: "thought_drop",
      ref,
      sourceStart: start,
      sourceEnd: end,
      raw,
    });
    removable.push({ start, end });
  }

  let visibleText = source;
  for (const range of removable.sort((a, b) => b.start - a.start)) {
    visibleText =
      visibleText.slice(0, range.start)
      + visibleText.slice(range.end);
  }

  return {
    visibleText: normalizeMindVisibleText(visibleText),
    actions,
  };
}
