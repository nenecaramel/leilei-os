import { Temporal } from "@js-temporal/polyfill";

export type SubjectStateTemporalBasis =
  | "user_supplied"
  | "source_message";

export type SubjectStateTemporal = {
  occurredAt: string;
  basis: SubjectStateTemporalBasis;
  sourceMessageId: string | null;
};

const TEMPORAL_KEY = "temporal_v1";

function record(
  value: unknown,
): Record<string, unknown> | null {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// Shared with the SQL projection: ISO date-only (UTC) or an explicit-offset
// ISO instant. Reject calendar rollover, leap seconds and 24:00 consistently.
export const SUBJECT_STATE_ISO_PATTERN =
  "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([Tt ]([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\\.[0-9]{1,9})?)?([Zz]|[+-](0[0-9]|1[0-5]):?[0-5][0-9]))?$";
// Exactly the ECMAScript trim whitespace set, also passed to PostgreSQL btrim.
export const SUBJECT_STATE_TRIM_CHARS =
  "\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
const isoPattern = new RegExp(SUBJECT_STATE_ISO_PATTERN);

function normalizeIso(value: string, label: string): string {
  const normalized = value.trim();
  if (!isoPattern.test(normalized) || normalized.startsWith("0000-")) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  const instant =
    normalized.length === 10
      ? `${normalized}T00:00:00Z`
      : normalized.toUpperCase();
  return Temporal.Instant.from(instant).toString({ fractionalSecondDigits: 3 });
}

export function writeSubjectStateTemporal(
  payload: Record<string, unknown> | null | undefined,
  temporal: SubjectStateTemporal,
): Record<string, unknown> {
  const occurredAt = normalizeIso(
    temporal.occurredAt,
    "occurredAt",
  );
  const sourceMessageId = temporal.sourceMessageId?.trim() || null;
  if (
    temporal.basis === "source_message"
    && sourceMessageId === null
  ) {
    throw new Error(
      "source_message temporal metadata requires sourceMessageId.",
    );
  }
  if (
    temporal.basis === "user_supplied"
    && sourceMessageId !== null
  ) {
    throw new Error(
      "user_supplied temporal metadata must not carry sourceMessageId.",
    );
  }

  return {
    ...(payload ?? {}),
    [TEMPORAL_KEY]: {
      occurredAt,
      basis: temporal.basis,
      sourceMessageId,
    },
  };
}

export function readSubjectStateTemporal(
  payload: Record<string, unknown> | null | undefined,
): SubjectStateTemporal | null {
  const temporal = record(payload?.[TEMPORAL_KEY]);
  if (temporal) {
    const basis =
      temporal.basis === "user_supplied"
      || temporal.basis === "source_message"
        ? temporal.basis
        : null;
    const rawOccurredAt =
      typeof temporal.occurredAt === "string"
        ? temporal.occurredAt
        : "";
    if (!basis || !rawOccurredAt.trim()) return null;

    let occurredAt: string;
    try {
      occurredAt = normalizeIso(rawOccurredAt, "occurredAt");
    } catch {
      return null;
    }
    const sourceMessageId =
      typeof temporal.sourceMessageId === "string"
        ? temporal.sourceMessageId.trim() || null
        : null;
    if (
      (basis === "source_message" && sourceMessageId === null)
      || (basis === "user_supplied" && sourceMessageId !== null)
    ) {
      return null;
    }
    return { occurredAt, basis, sourceMessageId };
  }

  // Legacy compatibility for manually authored Mind items.
  const manual = record(payload?.manual_v1);
  const legacyOccurredAt =
    typeof manual?.occurredAt === "string"
      ? manual.occurredAt.trim()
      : "";
  if (!legacyOccurredAt) return null;
  try {
    return {
      occurredAt: normalizeIso(
        legacyOccurredAt,
        "manual occurredAt",
      ),
      basis: "user_supplied",
      sourceMessageId: null,
    };
  } catch {
    return null;
  }
}

export function readSubjectStateOccurredAt(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  return readSubjectStateTemporal(payload)?.occurredAt ?? null;
}
