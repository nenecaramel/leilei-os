import { z } from "zod";
import type {
  ToyAckInput,
  ToyCommandRecord,
  ToyCreateInput,
} from "./toy-command-types.js";
import { TOY_ERROR_MAX_LENGTH } from "./toy-command-types.js";
import type {
  ToyAckRepositoryResult,
  ToyCommandRepository,
} from "./toy-command-repository.js";

const createSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    percent: z.number().int().min(1).max(40),
  }).strict(),
  z.object({ action: z.literal("stop") }).strict(),
]);

const ackSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("completed") }).strict(),
  z.object({
    status: z.literal("failed"),
    error: z.string().trim().min(1).max(TOY_ERROR_MAX_LENGTH),
  }).strict(),
]);

export type ToyDomainErrorCode =
  | "INVALID_INPUT"
  | "TOY_UNAVAILABLE"
  | "TOY_FORBIDDEN"
  | "COMMAND_NOT_FOUND"
  | "COMMAND_CONFLICT";

export class ToyDomainError extends Error {
  constructor(
    public readonly code: ToyDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToyDomainError";
  }
}

export class ToyCommandService {
  constructor(
    private readonly repository: ToyCommandRepository,
    private readonly boundUserId: string | undefined,
  ) {}

  async create(userId: string, input: unknown): Promise<ToyCommandRecord> {
    const bound = this.requireBoundUser();
    if (userId.trim() !== bound) {
      throw new ToyDomainError("TOY_FORBIDDEN", "Toy commands are unavailable.");
    }
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      throw new ToyDomainError("INVALID_INPUT", "The toy command is invalid.");
    }
    return this.repository.create(bound, parsed.data as ToyCreateInput);
  }

  async claim(): Promise<ToyCommandRecord | null> {
    return this.repository.claim(this.requireBoundUser());
  }

  async ack(id: string, input: unknown): Promise<ToyCommandRecord> {
    const bound = this.requireBoundUser();
    const commandId = z.string().uuid().safeParse(id);
    const parsed = ackSchema.safeParse(input);
    if (!commandId.success || !parsed.success) {
      throw new ToyDomainError("INVALID_INPUT", "The acknowledgement is invalid.");
    }
    const result: ToyAckRepositoryResult = await this.repository.ack(
      bound,
      commandId.data,
      parsed.data as ToyAckInput,
    );
    if (result.kind === "not_found") {
      throw new ToyDomainError("COMMAND_NOT_FOUND", "Command was not found.");
    }
    if (result.kind === "expired" || result.kind === "conflict") {
      throw new ToyDomainError("COMMAND_CONFLICT", "Command cannot be acknowledged.");
    }
    if (result.kind === "updated" || result.kind === "idempotent") {
      return result.command;
    }
    throw new ToyDomainError("COMMAND_CONFLICT", "Command cannot be acknowledged.");
  }

  private requireBoundUser(): string {
    const value = this.boundUserId?.trim();
    if (!value) {
      throw new ToyDomainError("TOY_UNAVAILABLE", "Toy command queue is unavailable.");
    }
    return value;
  }
}
