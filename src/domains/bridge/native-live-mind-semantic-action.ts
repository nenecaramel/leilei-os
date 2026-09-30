import type { InitialContextManifest } from "../runtime/context-invocation-contract.js";
import type { MindSemanticAction } from "../runtime/mind-semantic-action.js";
import type { ThoughtDropPort } from "../runtime/thought-runtime-repository.js";

export type MindSemanticActionReceipt = {
  actionIndex: number;
  kind: MindSemanticAction["kind"];
  ref: string;
  stateId: string | null;
  outcome: "applied" | "idempotent" | "rejected";
  code?: string;
};

export interface MindManifestReader {
  loadContextManifest(input: {
    userId: string;
    subjectId: string;
    manifestId: string;
  }): Promise<InitialContextManifest | null>;
}

/**
 * Applies `<thought_drop ref="T1" />`.
 *
 * The model only ever sees turn-local labels. The turn's Context Manifest is
 * the authority for which real state a label meant, so a label can never
 * resolve to a thought that was not in front of the model on that turn.
 */
export class NativeLiveMindSemanticActionExecutor {
  constructor(
    private readonly manifests: MindManifestReader,
    private readonly thoughts: ThoughtDropPort,
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
    const { action } = input;
    const receipt = (
      outcome: MindSemanticActionReceipt["outcome"],
      stateId: string | null,
      code?: string,
    ): MindSemanticActionReceipt => ({
      actionIndex: input.actionIndex,
      kind: action.kind,
      ref: action.ref,
      stateId,
      outcome,
      ...(code ? { code } : {}),
    });

    const manifest = await this.manifests.loadContextManifest({
      userId: input.userId,
      subjectId: this.subjectId,
      manifestId: input.prepareId,
    });
    const item = manifest?.items.find(
      (candidate) =>
        candidate.type === "thought"
        && candidate.alias === action.ref,
    );
    if (!manifest || manifest.conversationId !== input.conversationId) {
      return receipt("rejected", null, "MANIFEST_NOT_FOUND");
    }
    if (!item) {
      return receipt("rejected", null, "THOUGHT_REF_UNKNOWN");
    }

    const result = await this.thoughts.dropThought({
      userId: input.userId,
      subjectId: this.subjectId,
      stateId: item.sourceId,
      droppedAt: normalizeIso(this.now()),
      droppedByMessageId: input.assistantMessageId,
    });
    return result.outcome === "rejected"
      ? receipt("rejected", item.sourceId, result.code)
      : receipt(result.outcome, item.sourceId);
  }
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Semantic Mind action now() must return an ISO timestamp.");
  }
  return new Date(parsed).toISOString();
}
