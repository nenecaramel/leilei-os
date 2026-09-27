import assert from "node:assert/strict";
import test from "node:test";
import {
  isTerminalSubjectStateDisposition,
  requiresFullSubjectStatePayload,
  subjectStateRetentionPolicy,
  validateRuntimeRetentionSpec,
} from "../src/domains/runtime/runtime-data-lifecycle-contract.js";

test("Runtime retention contract separates canonical, subject-state and operational lifetimes", () => {
  assert.deepEqual(
    validateRuntimeRetentionSpec({
      dataClass: "canonical_history",
      retentionMode: "append_authority",
    }),
    {
      dataClass: "canonical_history",
      retentionMode: "append_authority",
    },
  );

  assert.deepEqual(
    validateRuntimeRetentionSpec({
      dataClass: "persistent_subject_state",
      retentionMode: "subject_lifecycle",
    }),
    {
      dataClass: "persistent_subject_state",
      retentionMode: "subject_lifecycle",
    },
  );

  assert.deepEqual(
    validateRuntimeRetentionSpec({
      dataClass: "operational",
      retentionMode: "ttl",
      ttlMs: 60_000,
    }),
    {
      dataClass: "operational",
      retentionMode: "ttl",
      ttlMs: 60_000,
    },
  );
});

test("operational records cannot silently become permanent", () => {
  assert.throws(
    () => validateRuntimeRetentionSpec({
      dataClass: "operational",
      retentionMode: "ttl",
    }),
    /positive finite ttlMs/,
  );
  assert.throws(
    () => validateRuntimeRetentionSpec({
      dataClass: "operational",
      retentionMode: "append_authority",
    }),
    /must declare TTL/,
  );
});

test("canonical history and subject state reject generic operational TTL semantics", () => {
  assert.throws(
    () => validateRuntimeRetentionSpec({
      dataClass: "canonical_history",
      retentionMode: "append_authority",
      ttlMs: 60_000,
    }),
    /must not be assigned an operational TTL/,
  );
  assert.throws(
    () => validateRuntimeRetentionSpec({
      dataClass: "persistent_subject_state",
      retentionMode: "ttl",
      ttlMs: 60_000,
    }),
    /subject_lifecycle/,
  );
});

test("archived is explicitly non-terminal while forgotten and purged are terminal", () => {
  assert.equal(isTerminalSubjectStateDisposition("active"), false);
  assert.equal(isTerminalSubjectStateDisposition("fading"), false);
  assert.equal(isTerminalSubjectStateDisposition("archived"), false);
  assert.equal(isTerminalSubjectStateDisposition("forgotten"), true);
  assert.equal(isTerminalSubjectStateDisposition("purged"), true);

  assert.equal(requiresFullSubjectStatePayload("archived"), true);
  assert.equal(requiresFullSubjectStatePayload("forgotten"), false);
  assert.equal(requiresFullSubjectStatePayload("purged"), false);
});


test("Subject State retention audit forbids generic forgetting outside Memory and Feel", () => {
  for (const kind of ["memory", "feel"] as const) {
    assert.deepEqual(subjectStateRetentionPolicy(kind), {
      automaticForgetting: true,
      mechanism: "decay_forget_purge",
    });
  }

  for (
    const kind of ["thought", "drive", "curiosity", "topic"] as const
  ) {
    assert.deepEqual(subjectStateRetentionPolicy(kind), {
      automaticForgetting: false,
      mechanism: "domain_evolution",
    });
  }
});
