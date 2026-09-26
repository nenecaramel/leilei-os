import assert from "node:assert/strict";
import test from "node:test";
import { SUBJECT_STATE_KINDS } from "../src/domains/runtime/subject-state-contract.js";
import {
  MIND_LIFECYCLE_PROFILES,
  assertMindLifecycleTransition,
  canPurgeMindState,
  isMindLifecycleTransitionAllowed,
  mindLifecycleProfile,
} from "../src/domains/runtime/mind-lifecycle-contract.js";

test("Mind lifecycle contract covers only current Mind kinds and excludes retired Dream", () => {
  assert.deepEqual(
    Object.keys(MIND_LIFECYCLE_PROFILES).sort(),
    SUBJECT_STATE_KINDS.filter((kind) => kind !== "dream").sort(),
  );
  assert.equal(SUBJECT_STATE_KINDS.includes("dream"), true);
  assert.equal("dream" in MIND_LIFECYCLE_PROFILES, false);
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
});

test("Topic ownership stays hybrid until the authored Topic entry point is retired", () => {
  assert.equal(mindLifecycleProfile("topic").ownership, "hybrid");
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
