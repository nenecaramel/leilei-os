import type {
  NativeLiveContentBlockInput,
} from "../../conversation/native-live-conversation-types.js";

const MURMUR_PATTERN = /<murmur>([\s\S]*?)<\/murmur>/giu;
const MURMUR_TAG_PATTERN = /<\/?murmur>/giu;
const XML_TAG_PATTERN = /<\/?[A-Za-z][A-Za-z0-9_:-]*(?:\s[^<>]*?)?>/gu;
const MAX_MURMUR_LENGTH = 1_200;

export type NativeLiveMurmurExtraction = {
  visibleBlocks: NativeLiveContentBlockInput[];
  murmurBlock: NativeLiveContentBlockInput | null;
};

export function extractNativeLiveMurmur(
  blocks: readonly NativeLiveContentBlockInput[],
): NativeLiveMurmurExtraction {
  let murmurText: string | null = null;
  const visibleBlocks: NativeLiveContentBlockInput[] = [];

  for (const block of blocks) {
    if (block.kind !== "text" || typeof block.text !== "string") {
      visibleBlocks.push({ ...block });
      continue;
    }

    const text = block.text;
    const lowerText = text.toLowerCase();
    if (
      !lowerText.includes("<murmur")
      && !lowerText.includes("</murmur>")
    ) {
      visibleBlocks.push({ ...block });
      continue;
    }

    for (const match of text.matchAll(MURMUR_PATTERN)) {
      if (murmurText !== null) continue;
      const normalized = normalizeMurmur(match[1] ?? "");
      if (normalized) murmurText = normalized;
    }

    let visibleText = text.replace(MURMUR_PATTERN, "");
    const danglingOpen = visibleText.search(/<murmur>/iu);
    if (danglingOpen >= 0) {
      visibleText = visibleText.slice(0, danglingOpen);
    }
    visibleText = visibleText
      .replace(MURMUR_TAG_PATTERN, "")
      .trim();

    if (visibleText) {
      visibleBlocks.push({
        ...block,
        text: visibleText,
      });
    }
  }

  return {
    visibleBlocks,
    murmurBlock: murmurText
      ? {
          kind: "murmur",
          rawType: "murmur",
          text: murmurText,
          payload: {
            schema_version: 1,
            identity: "murmur",
          },
        }
      : null,
  };
}

function normalizeMurmur(value: string): string | null {
  const withoutTags = value
    .replace(XML_TAG_PATTERN, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/gu, " ")
    .trim();

  if (!withoutTags) return null;
  return withoutTags.slice(0, MAX_MURMUR_LENGTH);
}
