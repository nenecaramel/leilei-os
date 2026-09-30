import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_SUBJECT_STATE_KINDS,
  SUBJECT_STATE_KINDS,
} from "../src/domains/runtime/subject-state-contract.js";
import {
  MIND_LIFECYCLE_PROFILES,
  assertMindLifecycleTransition,
  canPurgeMindState,
  isMindLifecycleTransitionAllowed,
  mindLifecycleProfile,
} from "../src/domains/runtime/mind-lifecycle-contract.js";

test("Mind lifecycle contract covers every persisted Subject State kind", () => {
  assert.deepEqual(
    Object.keys(MIND_LIFECYCLE_PROFILES).sort(),
    [...CURRENT_SUBJECT_STATE_KINDS].sort(),
  );
  assert.deepEqual(
    [...SUBJECT_STATE_KINDS],
    [...CURRENT_SUBJECT_STATE_KINDS],
  );
  assert.equal(SUBJECT_STATE_KINDS.includes("dream" as never), false);
});

test("Memory and Feel share the recoverable decay chain before physical purge", () => {
  for (const kind of ["memory", "feel"] as const) {
    const profile = mindLifecycleProfile(kind);
    assert.equal(profile.management, "managed");
    assert.equal(profile.initialState, "active");
    assert.equal(
      isMindLifecycleTransitionAllowed({
        kind,
        from: "active",
        to: "fading",
      }),
      true,
    );
    assert.equal(
      isMindLifecycleTransitionAllowed({
        kind,
        from: "fading",
        to: "active",
      }),
      true,
    );
    assert.equal(
      isMindLifecycleTransitionAllowed({
        kind,
        from: "archived",
        to: "forgotten",
      }),
      true,
    );
    assert.equal(canPurgeMindState({ kind, state: "forgotten" }), true);
    assert.equal(canPurgeMindState({ kind, state: "active" }), false);
  }
});

test("Thought has no clock: it is dropped by the subject or at the active limit, and is never purged", () => {
  const profile = mindLifecycleProfile("thought");
  assert.equal(profile.initialState, "active");
  assert.deepEqual(profile.drivers, ["subject_drop", "capacity"]);
  assert.equal(
    isMindLifecycleTransitionAllowed({
      kind: "thought",
      from: "active",
      to: "dropped",
    }),
    true,
  );
  // There is no dormancy, no reactivation and no automatic physical purge.
  for (const to of ["dormant", "fading", "archived", "forgotten"] as const) {
    assert.equal(
      isMindLifecycleTransitionAllowed({ kind: "thought", from: "active", to }),
      false,
    );
  }
  assert.equal(
    isMindLifecycleTransitionAllowed({
      kind: "thought",
      from: "dropped",
      to: "active",
    }),
    false,
  );
  assert.equal(canPurgeMindState({ kind: "thought", state: "dropped" }), false);
});

test("Drive, Curiosity and Topic are no longer Subject State kinds", () => {
  for (const retired of ["drive", "curiosity", "topic", "dream"]) {
    assert.equal(
      (CURRENT_SUBJECT_STATE_KINDS as readonly string[]).includes(retired),
      false,
    );
  }
});

test("every remaining kind is authored by the subject", () => {
  for (const kind of ["feel", "memory", "thought"] as const) {
    assert.equal(mindLifecycleProfile(kind).ownership, "authored");
  }
});

test("invalid lifecycle transitions fail closed", () => {
  assert.doesNotThrow(() => {
    assertMindLifecycleTransition({
      kind: "memory",
      from: "active",
      to: "fading",
    });
  });
  assert.throws(
    () => {
      assertMindLifecycleTransition({
        kind: "memory",
        from: "active",
        to: "forgotten",
      });
    },
    /Invalid memory lifecycle transition/,
  );
});
