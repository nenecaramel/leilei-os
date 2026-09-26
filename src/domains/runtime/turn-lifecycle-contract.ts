export const TURN_STATES = [
  "started",
  "producing",
  "streaming",
  "waiting_tool",
  "committed",
  "aborted",
] as const;

export type TurnState = (typeof TURN_STATES)[number];

const ALLOWED_TRANSITIONS: Readonly<Record<TurnState, readonly TurnState[]>> = {
  started: ["producing", "aborted"],
  producing: ["streaming", "waiting_tool", "committed", "aborted"],
  streaming: ["streaming", "waiting_tool", "committed", "aborted"],
  waiting_tool: ["producing", "streaming", "waiting_tool", "committed", "aborted"],
  committed: [],
  aborted: [],
};

export type TurnLifecycleRecord = {
  turnId: string;
  conversationId: string;
  pathHeadMessageId: string | null;
  state: TurnState;
  startedAt: string;
  updatedAt: string;
  committedAt?: string | null;
  abortedAt?: string | null;
  failureCode?: string | null;
};

export function assertTurnTransition(from: TurnState, to: TurnState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid turn lifecycle transition: ${from} -> ${to}.`);
  }
}
