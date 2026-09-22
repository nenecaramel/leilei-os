import type { NativeLiveConversation } from "../conversation/native-live-conversation-types.js";
import type { SubjectStateWrite } from "./subject-state-contract.js";
import { canonicalPathToHead } from "./surface-projector.js";

export type ProvisionalSettlementDecision =
  | {
      action: "keep";
      reason: "not_provisional" | "awaiting_user_continuation";
    }
  | {
      action: "promote";
      reason: "user_continued_current_path";
    }
  | {
      action: "invalidate";
      reason: "path_superseded";
    };

/**
 * Decides whether a provisional Mind write still belongs to the selected
 * canonical path. It does not mutate storage: persistence owns the actual
 * lifecycle transition and its transition ledger.
 */
export function decideProvisionalSettlement(
  state: SubjectStateWrite,
  conversation: NativeLiveConversation,
): ProvisionalSettlementDecision {
  if (state.lifecycle !== "provisional") {
    return { action: "keep", reason: "not_provisional" };
  }

  if (
    state.scope.applicability !== "path"
    || state.scope.conversationId !== conversation.id
    || !state.scope.pathHeadMessageId
  ) {
    return { action: "invalidate", reason: "path_superseded" };
  }

  const path = canonicalPathToHead(conversation);
  const index = path.findIndex(
    (message) => message.id === state.scope.pathHeadMessageId,
  );

  if (index < 0) {
    return { action: "invalidate", reason: "path_superseded" };
  }

  const laterMessages = path.slice(index + 1);
  if (laterMessages.some((message) => message.role === "user")) {
    return { action: "promote", reason: "user_continued_current_path" };
  }

  return { action: "keep", reason: "awaiting_user_continuation" };
}
