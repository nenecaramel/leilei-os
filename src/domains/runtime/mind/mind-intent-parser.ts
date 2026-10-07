import {
  normalizeMindVisibleText,
  overlapsMindProtectedRange,
  retiredMindProtectedRanges,
} from "./mind-protected-ranges.js";

export type CurrentMindWriteIntentKind =
  | "memory";

export type MindWriteIntentKind = CurrentMindWriteIntentKind;

export type MindWriteIntentShape<
  K extends MindWriteIntentKind = MindWriteIntentKind,
> = {
  kind: K;
  /** Original queued ordinal, only populated while decoding historical jobs. */
  writeOrdinal?: number;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  raw: string;
};

export type MindWriteIntent = MindWriteIntentShape<MindWriteIntentKind>;
export type CurrentMindWriteIntent =
  MindWriteIntentShape<CurrentMindWriteIntentKind>;

export type ParsedMindIntents = {
  visibleText: string;
  intents: CurrentMindWriteIntent[];
};

const TAG_PATTERN = /<(memory)>([\s\S]*?)<\/\1>/gi;

/**
 * Retired tags (feel, thought, drive, curiosity, topic, dream) are not parsed and are never
 * given a new meaning. They stay visible wherever they appear and produce no
 * Mind state, including when nested inside a current write.
 */
const NESTED_TAG_PATTERN =
  /<\/?(feel|memory|thought|drive|curiosity|topic|dream)>/i;

/**
 * Parses only explicit subject-authored write intents.
 *
 * Ordinary prose is never guessed into persistent state. Malformed, empty, or
 * nested tags remain visible text so a parser failure cannot silently create or
 * delete a memory.
 */
export function parseMindWriteIntents(source: string): ParsedMindIntents {
  const intents: CurrentMindWriteIntent[] = [];
  const removable: Array<{ start: number; end: number }> = [];
  const protectedRanges = retiredMindProtectedRanges(source);

  for (const match of source.matchAll(TAG_PATTERN)) {
    const raw = match[0];
    const kind =
      match[1]?.toLowerCase() as CurrentMindWriteIntentKind | undefined;
    const body = match[2]?.trim() ?? "";
    const start = match.index;

    if (
      !kind
      || start === undefined
      || !body
      || NESTED_TAG_PATTERN.test(body)
    ) {
      continue;
    }

    const end = start + raw.length;
    if (overlapsMindProtectedRange(protectedRanges, start, end)) continue;
    intents.push({
      kind,
      text: body,
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
    intents,
  };
}
