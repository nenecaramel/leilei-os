export const TOY_COMMAND_TTL_SECONDS = 10;
export const TOY_ERROR_MAX_LENGTH = 500;

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
  status: ToyCommandStatus;
  createdAt: Date;
  expiresAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  expiredAt: Date | null;
  error: string | null;
};

export type ToyCreateInput =
  | { action: "set"; percent: number }
  | { action: "stop" };

export type ToyAckInput =
  | { status: "completed" }
  | { status: "failed"; error: string };
