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

function normalizeIso(value: string, label: string): string {
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (!normalized || !Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
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
