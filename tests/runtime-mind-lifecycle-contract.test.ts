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

test("Drive must cool through satisfaction before dormant purge", () => {
  assert.equal(
    isMindLifecycleTransitionAllowed({
      kind: "drive",
      from: "active",
      to: "satisfied",
    }),
    true,
  );
  assert.equal(
    isMindLifecycleTransitionAllowed({
      kind: "drive",
      from: "satisfied",
      to: "dormant",
    }),
    true,
  );
  assert.equal(
    isMindLifecycleTransitionAllowed({
      kind: "drive",
      from: "active",
      to: "dormant",
    }),
    false,
  );
  assert.equal(canPurgeMindState({ kind: "drive", state: "dormant" }), true);
});

test("Thought, Curiosity, and Topic can go dormant and later reactivate", () => {
  for (const kind of ["thought", "curiosity", "topic"] as const) {
    assert.equal(
      isMindLifecycleTransitionAllowed({
        kind,
        from: "dormant",
        to: "active",
      }),
      true,
    );
    assert.equal(canPurgeMindState({ kind, state: "dormant" }), true);
  }

  assert.equal(
    isMindLifecycleTransitionAllowed({
      kind: "curiosity",
      from: "active",
      to: "resolved",
    }),
    true,
  );
  assert.equal(
    isMindLifecycleTransitionAllowed({
      kind: "curiosity",
      from: "resolved",
      to: "dormant",
    }),
    true,
  );
  assert.equal(
    isMindLifecycleTransitionAllowed({
      kind: "curiosity",
      from: "resolved",
      to: "active",
    }),
    true,
  );
});

test("Topic ownership is derived-only after authored Topic retirement", () => {
  assert.equal(mindLifecycleProfile("topic").ownership, "derived");
  for (const kind of [
    "feel",
    "memory",
    "drive",
    "thought",
    "curiosity",
  ] as const) {
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


test("Mind retirement policy has explicit terminal preconditions and no implicit retention", async () => {
  const {
    MIND_RETIREMENT_PRECONDITIONS,
    validateMindRetirementPolicy,
  } = await import("../src/domains/runtime/mind-retirement-policy.js");

  assert.deepEqual(MIND_RETIREMENT_PRECONDITIONS, {
    drive: "dormant",
    thought: "dormant",
    curiosity: "resolved_or_dormant",
    topic: "dormant",
  });

  assert.deepEqual(validateMindRetirementPolicy({}), {});
  assert.deepEqual(
    validateMindRetirementPolicy({
      topic: { retentionHours: 720 },
    }),
    {
      topic: { retentionHours: 720 },
    },
  );
  assert.throws(
    () => validateMindRetirementPolicy({
      drive: { retentionHours: 0 },
    }),
    /retentionHours must be positive/,
  );
});
