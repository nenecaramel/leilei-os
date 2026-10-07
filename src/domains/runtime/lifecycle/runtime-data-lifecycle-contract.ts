export type RuntimeDataClass =
  | "canonical_history"
  | "persistent_subject_state"
  | "operational";

export type RuntimeRetentionMode =
  | "append_authority"
  | "subject_lifecycle"
  | "ttl";

export type RuntimeRetentionSpec = {
  dataClass: RuntimeDataClass;
  retentionMode: RuntimeRetentionMode;
  ttlMs?: number | null;
};

export type SubjectStateRetentionKind = "memory";
export type SubjectStateRetentionPolicy = {
  automaticForgetting: true;
  mechanism: "decay_forget_purge";
};

/** Persistent memories use their lifecycle, never a generic age-based TTL. */
export function subjectStateRetentionPolicy(
  kind: SubjectStateRetentionKind,
): SubjectStateRetentionPolicy {
  if (kind !== "memory") {
    throw new Error("Unhandled Subject State retention kind: " + String(kind));
  }
  return { automaticForgetting: true, mechanism: "decay_forget_purge" };
}

/**
 * Minimal lifecycle guardrail for new Runtime persistence.
 *
 * Canonical history is the durable authority, subject state is allowed to be
 * born and later truly forgotten/purged, and operational/debug records must
 * declare a bounded TTL instead of silently becoming permanent history.
 */
export function validateRuntimeRetentionSpec(
  spec: RuntimeRetentionSpec,
): RuntimeRetentionSpec {
  if (spec.dataClass === "canonical_history") {
    if (spec.retentionMode !== "append_authority") {
      throw new Error(
        "Canonical history must use append_authority retention.",
      );
    }
    if (spec.ttlMs != null) {
      throw new Error(
        "Canonical history must not be assigned an operational TTL.",
      );
    }
    return spec;
  }

  if (spec.dataClass === "persistent_subject_state") {
    if (spec.retentionMode !== "subject_lifecycle") {
      throw new Error(
        "Persistent subject state must use subject_lifecycle retention.",
      );
    }
    if (spec.ttlMs != null) {
      throw new Error(
        "Persistent subject state must not use a generic operational TTL.",
      );
    }
    return spec;
  }

  if (spec.retentionMode !== "ttl") {
    throw new Error(
      "Operational Runtime data must declare TTL retention.",
    );
  }
  if (
    typeof spec.ttlMs !== "number"
    || !Number.isFinite(spec.ttlMs)
    || spec.ttlMs <= 0
  ) {
    throw new Error(
      "Operational Runtime data requires a positive finite ttlMs.",
    );
  }
  return spec;
}

export type SubjectStateLifecycleDisposition =
  | "active"
  | "fading"
  | "archived"
  | "forgotten"
  | "purged";

export function isTerminalSubjectStateDisposition(
  value: SubjectStateLifecycleDisposition,
): boolean {
  return value === "forgotten" || value === "purged";
}

export function requiresFullSubjectStatePayload(
  value: SubjectStateLifecycleDisposition,
): boolean {
  return (
    value === "active"
    || value === "fading"
    || value === "archived"
  );
}
