import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalPositionToWorld,
  fitViewportToPositions,
  parseUniverseViewport,
  revealWorldPoint,
  screenToWorld,
  serializeUniverseViewport,
  worldToCanonicalPosition,
  worldToScreen,
  zoomAroundScreenPoint,
} from "../web/src/pages/universe/universe-map-transform.js";

const close = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !== ${expected}`);
};

test("world/screen transforms round-trip at arbitrary pan and zoom", () => {
  const viewport = { x: 137, y: -82, scale: 1.75 };
  const world = { x: 412, y: 269 };
  const screen = worldToScreen(world, viewport);
  const result = screenToWorld(screen, viewport);
  close(result.x, world.x);
  close(result.y, world.y);
});

test("zoom keeps the gesture focal point stationary", () => {
  const viewport = { x: 80, y: -20, scale: 1 };
  const focal = { x: 240, y: 180 };
  const before = screenToWorld(focal, viewport);
  const zoomed = zoomAroundScreenPoint(viewport, focal, 2);
  const after = screenToWorld(focal, zoomed);
  close(after.x, before.x);
  close(after.y, before.y);
  assert.equal(zoomed.scale, 2);
});

test("fit viewport includes every positioned node with padding", () => {
  const viewport = fitViewportToPositions(
    [{ x: 10, y: 20 }, { x: 90, y: 70 }],
    { width: 400, height: 300 },
  );
  for (const position of [{ x: 10, y: 20 }, { x: 90, y: 70 }]) {
    const screen = worldToScreen(canonicalPositionToWorld(position), viewport);
    assert.ok(screen.x >= 0 && screen.x <= 400);
    assert.ok(screen.y >= 0 && screen.y <= 300);
  }
});

test("canonical/world conversion preserves valid node positions", () => {
  const canonical = { x: 12.5, y: 87.25 };
  const roundTrip = worldToCanonicalPosition(canonicalPositionToWorld(canonical));
  close(roundTrip.x, canonical.x);
  close(roundTrip.y, canonical.y);
});

test("world writes clamp canonical positions to the legal 0..100 domain", () => {
  assert.deepEqual(worldToCanonicalPosition({ x: -10, y: 1010 }), { x: 0, y: 100 });
  assert.deepEqual(worldToCanonicalPosition({ x: 1200, y: -5 }), { x: 100, y: 0 });
});

test("reveal pan preserves zoom and leaves an already visible point alone", () => {
  const viewport = { x: 0, y: 0, scale: 2 };
  assert.deepEqual(revealWorldPoint(viewport, { x: 100, y: 100 }, { width: 400, height: 300 }), viewport);
  const revealed = revealWorldPoint(viewport, { x: 300, y: 200 }, { width: 400, height: 300 });
  assert.equal(revealed.scale, viewport.scale);
  assert.ok(revealed.x < viewport.x || revealed.y < viewport.y);
});

test("invalid stored viewport data is rejected", () => {
  assert.equal(parseUniverseViewport(null), null);
  assert.equal(parseUniverseViewport("{}"), null);
  assert.equal(parseUniverseViewport(JSON.stringify({ x: 1, y: 2, scale: 0 })), null);
  assert.deepEqual(parseUniverseViewport(JSON.stringify({ x: 1, y: 2, scale: 1 })), { x: 1, y: 2, scale: 1 });
  assert.equal(serializeUniverseViewport({ x: 1, y: 2, scale: 1 }), JSON.stringify({ x: 1, y: 2, scale: 1 }));
});
