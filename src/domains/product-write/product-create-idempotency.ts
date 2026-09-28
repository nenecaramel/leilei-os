import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { productCreateIdempotency } from "../../database/schema.js";

export const PRODUCT_CREATE_IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const PRODUCT_CREATE_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const PRODUCT_CREATE_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
export const PRODUCT_CREATE_FINGERPRINT_VERSION =
  "leilei-os:product-create:v1";

export type ProductCreateOperation =
  | "workspace_create"
  | "workspace_resource_create"
  | "mind_manual_create";

export type ProductCreateResourceType =
  | "workspace"
  | "workspace_resource"
  | "mind_state";

export type ProductCreateIdempotencyRecord = {
  requestHash: string;
  resourceType: ProductCreateResourceType;
  resourceId: string;
  response: Record<string, unknown>;
};

type Database = ReturnType<typeof createDatabase>["db"];
export type ProductCreateIdempotencyTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export class ProductCreateIdempotencyError extends Error {
  constructor(readonly code: "INVALID_IDEMPOTENCY_KEY") {
    super(code);
    this.name = "ProductCreateIdempotencyError";
  }
}

export function normalizeProductCreateIdempotencyKey(
  value: unknown,
): string {
  if (typeof value !== "string") {
    throw new ProductCreateIdempotencyError("INVALID_IDEMPOTENCY_KEY");
  }
  const normalized = value.trim();
  if (
    normalized.length < PRODUCT_CREATE_IDEMPOTENCY_KEY_MIN_LENGTH
    || normalized.length > PRODUCT_CREATE_IDEMPOTENCY_KEY_MAX_LENGTH
    || !PRODUCT_CREATE_IDEMPOTENCY_KEY_PATTERN.test(normalized)
  ) {
    throw new ProductCreateIdempotencyError("INVALID_IDEMPOTENCY_KEY");
  }
  return normalized;
}

export function hashProductCreateRequest(value: unknown): string {
  const canonical = serializeCanonicalValue(value);
  return createHash("sha256")
    .update(
      `${PRODUCT_CREATE_FINGERPRINT_VERSION}\n${canonical}`,
      "utf8",
    )
    .digest("hex");
}

export async function lockAndReadProductCreateIdempotency(
  transaction: ProductCreateIdempotencyTransaction,
  input: {
    userId: string;
    operation: ProductCreateOperation;
    idempotencyKey: string;
  },
): Promise<ProductCreateIdempotencyRecord | null> {
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`${input.userId}:${input.operation}:${input.idempotencyKey}`},
        0
      )
    )
  `);

  const [record] = await transaction
    .select({
      requestHash: productCreateIdempotency.requestHash,
      resourceType: productCreateIdempotency.resourceType,
      resourceId: productCreateIdempotency.resourceId,
      response: productCreateIdempotency.response,
    })
    .from(productCreateIdempotency)
    .where(and(
      eq(productCreateIdempotency.userId, input.userId),
      eq(productCreateIdempotency.operation, input.operation),
      eq(productCreateIdempotency.idempotencyKey, input.idempotencyKey),
    ))
    .limit(1);

  return record ?? null;
}

export async function recordProductCreateIdempotency(
  transaction: ProductCreateIdempotencyTransaction,
  input: {
    userId: string;
    operation: ProductCreateOperation;
    idempotencyKey: string;
    requestHash: string;
    resourceType: ProductCreateResourceType;
    resourceId: string;
    response: Record<string, unknown>;
  },
): Promise<void> {
  await transaction.insert(productCreateIdempotency).values(input);
}

function serializeCanonicalValue(value: unknown): string {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("UNSUPPORTED_PRODUCT_CREATE_FINGERPRINT_VALUE");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const serialized: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new Error("UNSUPPORTED_PRODUCT_CREATE_FINGERPRINT_VALUE");
      }
      serialized.push(serializeCanonicalValue(value[index]));
    }
    return `[${serialized.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype
      && prototype !== null
    ) {
      throw new Error("UNSUPPORTED_PRODUCT_CREATE_FINGERPRINT_VALUE");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) =>
        `${JSON.stringify(key)}:${serializeCanonicalValue(record[key])}`
      )
      .join(",")}}`;
  }
  throw new Error("UNSUPPORTED_PRODUCT_CREATE_FINGERPRINT_VALUE");
}
