export const TOY_COMMAND_TTL_SECONDS = 10;
export const TOY_ERROR_MAX_LENGTH = 500;
export const TOY_DEFAULT_DURATION_SECONDS = 60;
export const TOY_MAX_DURATION_SECONDS = 1200;

export type ToyCommandAction = "set" | "stop";
export type ToyCommandStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed"
  | "expired";

export type ToyCommandRecord = {
  id: string;
  userId: string;
  action: ToyCommandAction;
  percent: number | null;
  durationSeconds: number | null;
  status: ToyCommandStatus;
  createdAt: Date;
  expiresAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  expiredAt: Date | null;
  error: string | null;
};

export type ToyCreateInput =
  | { action: "set"; percent: number; durationSeconds?: number }
  | { action: "stop" };

export type ToyAckInput =
  | { status: "completed" }
  | { status: "failed"; error: string };
