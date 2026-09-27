import { createHash } from "node:crypto";
import type {
  CuriosityResolutionResult,
  CuriosityResolutionService,
} from "../runtime/curiosity-resolution.js";
import type {
  DriveSatisfactionResult,
  DriveSatisfactionService,
} from "../runtime/drive-satisfaction-runtime-repository.js";
import type {
  MindSemanticAction,
} from "../runtime/mind-semantic-action.js";

export type MindSemanticActionReceipt = {
  actionIndex: number;
  kind: MindSemanticAction["kind"];
  stateId: string;
  outcome: "applied" | "idempotent" | "rejected";
  code?: string;
};

type DriveSemanticSatisfaction = Pick<
  DriveSatisfactionService,
  "satisfySemantic"
>;

type CuriositySemanticResolution = Pick<
  CuriosityResolutionService,
  "resolve"
>;

export class NativeLiveMindSemanticActionExecutor {
  constructor(
    private readonly driveSatisfaction: DriveSemanticSatisfaction,
    private readonly curiosityResolution: CuriositySemanticResolution,
    private readonly subjectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    if (!subjectId.trim()) {
      throw new Error("Semantic Mind action subjectId must not be blank.");
    }
  }

  async execute(input: {
    userId: string;
    conversationId: string;
    assistantMessageId: string;
    prepareId: string;
    actionIndex: number;
    action: MindSemanticAction;
  }): Promise<MindSemanticActionReceipt> {
    const now = normalizeIso(this.now());
    if (input.action.kind === "mind_satisfy") {
      const result = await this.driveSatisfaction.satisfySemantic({
        userId: input.userId,
        subjectId: this.subjectId,
        driveStateId: input.action.stateId,
        level: input.action.level,
        idempotencyKey:
          nativeLiveMindSemanticActionIdempotencyKey(
            input.prepareId,
            input.actionIndex,
          ),
        evidence: {
          kind: "assistant_message",
          conversationId: input.conversationId,
          messageId: input.assistantMessageId,
        },
        now,
      });
      return receiptFromDrive(input.actionIndex, input.action.stateId, result);
    }

    const result = await this.curiosityResolution.resolve({
      userId: input.userId,
      subjectId: this.subjectId,
      curiosityStateId: input.action.stateId,
      conversationId: input.conversationId,
      resolutionSourceId: input.assistantMessageId,
      idempotencyKey:
        nativeLiveMindSemanticActionIdempotencyKey(
          input.prepareId,
          input.actionIndex,
        ),
      now,
    });
    return receiptFromCuriosity(
      input.actionIndex,
      input.action.stateId,
      result,
    );
  }
}

export function nativeLiveMindSemanticActionIdempotencyKey(
  prepareId: string,
  actionIndex: number,
): string {
  if (!Number.isInteger(actionIndex) || actionIndex < 0) {
    throw new Error("Semantic Mind action index must be nonnegative.");
  }
  const digest = createHash("sha256")
    .update(
      "leileios:mind-semantic-action:v1:"
      + prepareId
      + ":"
      + actionIndex,
      "utf8",
    )
    .digest("hex");
  return "mind-action:" + digest.slice(0, 48);
}

function receiptFromDrive(
  actionIndex: number,
  stateId: string,
  result: DriveSatisfactionResult,
): MindSemanticActionReceipt {
  if (result.outcome === "rejected") {
    return {
      actionIndex,
      kind: "mind_satisfy",
      stateId,
      outcome: "rejected",
      code: result.code,
    };
  }
  return {
    actionIndex,
    kind: "mind_satisfy",
    stateId,
    outcome: result.outcome,
  };
}

function receiptFromCuriosity(
  actionIndex: number,
  stateId: string,
  result: CuriosityResolutionResult,
): MindSemanticActionReceipt {
  if (result.outcome === "rejected") {
    return {
      actionIndex,
      kind: "mind_resolve",
      stateId,
      outcome: "rejected",
      code: result.code,
    };
  }
  return {
    actionIndex,
    kind: "mind_resolve",
    stateId,
    outcome: result.outcome,
  };
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Semantic Mind action now() must return an ISO timestamp.");
  }
  return new Date(parsed).toISOString();
}
