import { createHash } from "node:crypto";

export const MCP_PAGINATION_CURSOR_MAX_LENGTH = 2_048;

export type McpPaginationMetadata = {
  returned: number;
  has_more: boolean;
  next_cursor: string | null;
};

type CursorEnvelope = {
  v: 1;
  tool: string;
  fingerprint: string;
  offset: number;
};

export class McpPaginationCursorError extends Error {
  constructor() {
    super("Invalid or mismatched pagination cursor.");
    this.name = "McpPaginationCursorError";
  }
}

export function decodeMcpPaginationCursor(
  cursor: string | undefined,
  tool: string,
  context: unknown,
): number {
  if (cursor === undefined) return 0;
  if (
    typeof cursor !== "string"
    || cursor.length === 0
    || cursor.length > MCP_PAGINATION_CURSOR_MAX_LENGTH
  ) {
    throw new McpPaginationCursorError();
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CursorEnvelope>;
    if (
      parsed.v !== 1
      || parsed.tool !== tool
      || parsed.fingerprint !== cursorFingerprint(context)
      || typeof parsed.offset !== "number"
      || !Number.isSafeInteger(parsed.offset)
      || parsed.offset < 0
      || parsed.offset > 10_000_000
    ) {
      throw new McpPaginationCursorError();
    }
    return parsed.offset;
  } catch (error) {
    if (error instanceof McpPaginationCursorError) throw error;
    throw new McpPaginationCursorError();
  }
}

export function paginateMcpRows<T>(input: {
  rows: readonly T[];
  pageSize: number;
  offset: number;
  tool: string;
  context: unknown;
}): { items: T[]; metadata: McpPaginationMetadata } {
  const items = input.rows.slice(0, input.pageSize);
  const hasMore = input.rows.length > input.pageSize;
  return {
    items,
    metadata: {
      returned: items.length,
      has_more: hasMore,
      next_cursor: hasMore
        ? encodeMcpPaginationCursor(
            input.tool,
            input.context,
            input.offset + items.length,
          )
        : null,
    },
  };
}

function encodeMcpPaginationCursor(
  tool: string,
  context: unknown,
  offset: number,
): string {
  const envelope: CursorEnvelope = {
    v: 1,
    tool,
    fingerprint: cursorFingerprint(context),
    offset,
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

function cursorFingerprint(context: unknown): string {
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
      throw new McpPaginationCursorError();
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new McpPaginationCursorError();
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
  throw new McpPaginationCursorError();
}
