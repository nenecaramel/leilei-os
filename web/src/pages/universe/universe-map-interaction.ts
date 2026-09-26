import type { UniversePoint } from "./universe-map-transform";

export type UniverseMapMode =
  | { kind: "browse" }
  | { kind: "placing-node" }
  | { kind: "moving-node"; nodeId: string };

export type UniverseMapInteractionState = {
  mode: UniverseMapMode;
  selectedNodeId: string | null;
};

export type UniverseMapAction =
  | { type: "tap-planet"; nodeId: string; world: UniversePoint }
  | { type: "tap-empty"; world: UniversePoint }
  | { type: "begin-placing-node" }
  | { type: "long-press"; nodeId: string; world: UniversePoint }
  | { type: "cancel" };

type UniverseMapEffect =
  | { type: "open-node"; nodeId: string }
  | { type: "create-node"; world: UniversePoint }
  | { type: "begin-move"; nodeId: string; world: UniversePoint };

export type UniverseMapTransition = {
  state: UniverseMapInteractionState;
  effects: UniverseMapEffect[];
};

export function initialUniverseMapInteraction(): UniverseMapInteractionState {
  return { mode: { kind: "browse" }, selectedNodeId: null };
}

export function reduceUniverseMapInteraction(
  state: UniverseMapInteractionState,
  action: UniverseMapAction,
): UniverseMapTransition {
  switch (action.type) {
    case "begin-placing-node":
      return { state: { mode: { kind: "placing-node" }, selectedNodeId: null }, effects: [] };
    case "cancel":
      return { state: initialUniverseMapInteraction(), effects: [] };
    case "long-press":
      if (state.mode.kind !== "browse") return { state, effects: [] };
      return {
        state: { mode: { kind: "moving-node", nodeId: action.nodeId }, selectedNodeId: action.nodeId },
        effects: [{ type: "begin-move", nodeId: action.nodeId, world: action.world }],
      };
    case "tap-empty":
      if (state.mode.kind === "placing-node") {
        return {
          state: { mode: { kind: "browse" }, selectedNodeId: null },
          effects: [{ type: "create-node", world: action.world }],
        };
      }
      if (state.mode.kind !== "browse") return { state, effects: [] };
      return { state: { mode: { kind: "browse" }, selectedNodeId: null }, effects: [] };
    case "tap-planet":
      if (state.mode.kind !== "browse") return { state, effects: [] };
      if (state.selectedNodeId === action.nodeId) {
        return { state, effects: [{ type: "open-node", nodeId: action.nodeId }] };
      }
      return {
        state: { mode: { kind: "browse" }, selectedNodeId: action.nodeId },
        effects: [],
      };
  }
}
