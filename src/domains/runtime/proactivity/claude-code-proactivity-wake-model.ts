import type {
  ProactivityDeliberationDraft,
} from "./proactivity-wake-contract.js";

const MAX_CONTACT_TEXT_CODE_POINTS = 2_000;

export function parseClaudeCodeProactivityWakeOutput(
  rawOutput: string,
): ProactivityDeliberationDraft {
  const normalized = stripSingleJsonFence(rawOutput.trim());
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw new Error(
      "Proactivity wake deliberation did not return valid JSON.",
    );
  }
  if (!isRecord(value)) {
    throw new Error(
      "Proactivity wake deliberation output must be an object.",
    );
  }

  if (value.outcome === "quiet" || value.outcome === "reflect") {
    if (Object.keys(value).length !== 1) {
      throw new Error(
        "Proactivity wake quiet/reflect output contains unexpected fields.",
      );
    }
    return { outcome: value.outcome };
  }

  if (value.outcome === "contact_candidate") {
    const keys = Object.keys(value).sort();
    if (
      keys.length !== 2
      || keys[0] !== "outcome"
      || keys[1] !== "text"
      || typeof value.text !== "string"
    ) {
      throw new Error(
        "Proactivity wake contact candidate output is invalid.",
      );
    }
    const text = value.text
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      .trim();
    if (
      text.length === 0
      || [...text].length > MAX_CONTACT_TEXT_CODE_POINTS
    ) {
      throw new Error(
        "Proactivity wake contact candidate text is empty or too long.",
      );
    }
    return {
      outcome: "contact_candidate",
      text,
    };
  }

  throw new Error(
    "Proactivity wake deliberation outcome is invalid.",
  );
}

function stripSingleJsonFence(value: string): string {
  const match = value.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/iu);
  return match ? match[1]!.trim() : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
