import { createHash } from "node:crypto";
import { codePointLength, sliceCodePoints } from "../../shared/unicode.js";

export const DEFAULT_MCP_BOUNDED_READ_CHARS = 12_000;
export const MAX_MCP_BOUNDED_READ_CHARS = 30_000;
export const MCP_BOUNDED_READ_CURSOR_MAX_LENGTH = 2_048;

export type McpBoundedReadMetadata = {
  returned_chars: number;
  total_chars: number;
  truncated: boolean;
  next_cursor: string | null;
};

type BoundedReadCursorEnvelope = {
  v: 1;
  tool: string;
  fingerprint: string;
  offset: number;
};

export class McpBoundedReadCursorError extends Error {
  constructor() {
    super("Invalid or stale bounded-read cursor.");
    this.name = "McpBoundedReadCursorError";
  }
}

export function boundedReadInputSchemaFields(zod: typeof import("zod").z) {
  return {
    max_chars: zod.number().int().min(1).max(MAX_MCP_BOUNDED_READ_CHARS)
      .default(DEFAULT_MCP_BOUNDED_READ_CHARS)
      .optional()
      .describe(
        `Maximum Unicode code points to return from the body in this call. Defaults to ${DEFAULT_MCP_BOUNDED_READ_CHARS}; maximum ${MAX_MCP_BOUNDED_READ_CHARS}.`,
      ),
    cursor: zod.string().min(1).max(MCP_BOUNDED_READ_CURSOR_MAX_LENGTH)
      .optional()
      .describe("Opaque continuation cursor returned by the previous bounded read of the same unchanged record."),
  };
}

export function boundedReadMetadataSchema(zod: typeof import("zod").z) {
  return zod.object({
    returned_chars: zod.number().int().nonnegative(),
    total_chars: zod.number().int().nonnegative(),
    truncated: zod.boolean(),
    next_cursor: zod.string().nullable(),
  }).strict();
}

export function sliceMcpBoundedContent(input: {
  content: string;
  maxChars?: number;
  cursor?: string;
  tool: string;
  context: unknown;
}): { content: string; metadata: McpBoundedReadMetadata } {
  const maxChars = input.maxChars ?? DEFAULT_MCP_BOUNDED_READ_CHARS;
  if (
    !Number.isInteger(maxChars)
    || maxChars < 1
    || maxChars > MAX_MCP_BOUNDED_READ_CHARS
  ) {
    throw new McpBoundedReadCursorError();
  }

  const totalChars = codePointLength(input.content);
  const offset = decodeCursor(input.cursor, input.tool, input.context);
  if (offset > totalChars) {
    throw new McpBoundedReadCursorError();
  }

  const end = Math.min(totalChars, offset + maxChars);
  const content = sliceCodePoints(input.content, offset, end);
  const truncated = end < totalChars;

  return {
    content,
    metadata: {
      returned_chars: end - offset,
      total_chars: totalChars,
      truncated,
      next_cursor: truncated
        ? encodeCursor(input.tool, input.context, end)
        : null,
    },
  };
}

function decodeCursor(
  cursor: string | undefined,
  tool: string,
  context: unknown,
): number {
  if (cursor === undefined) return 0;
  if (
    typeof cursor !== "string"
    || cursor.length === 0
    || cursor.length > MCP_BOUNDED_READ_CURSOR_MAX_LENGTH
  ) {
    throw new McpBoundedReadCursorError();
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<BoundedReadCursorEnvelope>;
    if (
      parsed.v !== 1
      || parsed.tool !== tool
      || parsed.fingerprint !== fingerprint(context)
      || typeof parsed.offset !== "number"
      || !Number.isSafeInteger(parsed.offset)
      || parsed.offset < 0
    ) {
      throw new McpBoundedReadCursorError();
    }
    return parsed.offset;
  } catch (error) {
    if (error instanceof McpBoundedReadCursorError) throw error;
    throw new McpBoundedReadCursorError();
  }
}

function encodeCursor(
  tool: string,
  context: unknown,
  offset: number,
): string {
  const payload: BoundedReadCursorEnvelope = {
    v: 1,
    tool,
    fingerprint: fingerprint(context),
    offset,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function fingerprint(context: unknown): string {
  return createHash("sha256")
    .update(canonicalize(context), "utf8")
    .digest("hex");
}

function canonicalize(value: unknown): string {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || typeof value === "number"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new McpBoundedReadCursorError();
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new McpBoundedReadCursorError();
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new McpBoundedReadCursorError();
}
