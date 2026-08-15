import assert from "node:assert/strict";
import test from "node:test";
import {
  initialUniverseMapInteraction,
  reduceUniverseMapInteraction,
  type UniverseMapAction,
} from "../web/src/pages/universe/universe-map-interaction.js";

const tapPlanet = (nodeId: string): UniverseMapAction => ({ type: "tap-planet", nodeId, world: { x: 10, y: 20 } });

test("first tap selects and second tap requests paper detail", () => {
  const first = reduceUniverseMapInteraction(initialUniverseMapInteraction(), tapPlanet("n1"));
  assert.deepEqual(first.state, { mode: { kind: "browse" }, selectedNodeId: "n1" });
  assert.deepEqual(first.effects, []);
  const second = reduceUniverseMapInteraction(first.state, tapPlanet("n1"));
  assert.deepEqual(second.effects, [{ type: "open-node", nodeId: "n1" }]);
});

test("place mode converts a map tap into create intent, not selection", () => {
  const placing = reduceUniverseMapInteraction(initialUniverseMapInteraction(), { type: "begin-placing-node" });
  const result = reduceUniverseMapInteraction(placing.state, { type: "tap-empty", world: { x: 33, y: 44 } });
  assert.deepEqual(result.effects, [{ type: "create-node", world: { x: 33, y: 44 } }]);
  assert.equal(result.state.selectedNodeId, null);
  assert.deepEqual(result.state.mode, { kind: "browse" });
});

test("relation target mode converts a planet tap into relation intent", () => {
  const choosing = reduceUniverseMapInteraction(initialUniverseMapInteraction(), { type: "begin-relation", sourceNodeId: "source" });
  const result = reduceUniverseMapInteraction(choosing.state, tapPlanet("target"));
  assert.deepEqual(result.effects, [{ type: "open-relation", sourceNodeId: "source", targetNodeId: "target" }]);
  assert.deepEqual(result.state.mode, { kind: "browse" });
});

test("long press move cannot begin while placing or choosing a relation target", () => {
  for (const action of [
    { type: "begin-placing-node" } as const,
    { type: "begin-relation", sourceNodeId: "source" } as const,
  ]) {
    const started = reduceUniverseMapInteraction(initialUniverseMapInteraction(), action);
    const result = reduceUniverseMapInteraction(started.state, { type: "long-press", nodeId: "n1", world: { x: 1, y: 2 } });
    assert.deepEqual(result.effects, []);
    assert.notEqual(result.state.mode.kind, "moving-node");
  }
});

test("cancel returns to browse without a write effect", () => {
  const placing = reduceUniverseMapInteraction(initialUniverseMapInteraction(), { type: "begin-placing-node" });
  const result = reduceUniverseMapInteraction(placing.state, { type: "cancel" });
  assert.deepEqual(result.state, { mode: { kind: "browse" }, selectedNodeId: null });
  assert.deepEqual(result.effects, []);
});
