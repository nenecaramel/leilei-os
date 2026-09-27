export type CurrentMindWriteIntentKind =
  | "feel"
  | "memory"
  | "drive"
  | "thought"
  | "curiosity";

export type MindWriteIntentKind = CurrentMindWriteIntentKind;

export type MindWriteIntentShape<
  K extends MindWriteIntentKind = MindWriteIntentKind,
> = {
  kind: K;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  raw: string;
};

export type MindWriteIntent = MindWriteIntentShape<MindWriteIntentKind>;
export type CurrentMindWriteIntent = MindWriteIntent;

export type ParsedMindIntents = {
  visibleText: string;
  intents: CurrentMindWriteIntent[];
};

const TAG_PATTERN = /<(feel|memory|drive|thought|curiosity)>([\s\S]*?)<\/\1>/gi;
const NESTED_TAG_PATTERN =
  /<\/?(feel|memory|drive|thought|curiosity|topic|dream)>/i;

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
    visibleText: visibleText
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    intents,
  };
}
