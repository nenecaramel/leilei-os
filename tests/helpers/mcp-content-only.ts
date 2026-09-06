import assert from "node:assert/strict";

type TextContentResult = {
  content?: readonly unknown[];
};

export function contentText(result: TextContentResult): string {
  const text = (result.content ?? [])
    .filter((item): item is { type: "text"; text: string } => (
      typeof item === "object"
      && item !== null
      && "type" in item
      && item.type === "text"
      && "text" in item
      && typeof item.text === "string"
    ))
    .map((item) => item.text)
    .join("\n");
  assert.notEqual(text, "", "MCP response must expose text content");
  return text;
}

export function assertContentIncludes(result: TextContentResult, ...needles: string[]): string {
  const text = contentText(result);
  for (const needle of needles) assert.match(text, new RegExp(escapeRegExp(needle)), `content should include ${needle}`);
  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
