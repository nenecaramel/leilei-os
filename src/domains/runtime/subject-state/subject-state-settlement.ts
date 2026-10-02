import type { NativeLiveConversation } from "../../conversation/native-live-conversation-types.js";
import type { SubjectStateWrite } from "./subject-state-contract.js";
import { canonicalPathToHead } from "../shared/surface-projector.js";

export type ProvisionalSettlementDecision =
  | {
      action: "keep";
      reason: "already_resolved" | "awaiting_user_continuation";
    }
  | {
      action: "settle";
      reason: "user_continued_current_path";
    }
  | {
      action: "invalidate";
      reason: "path_superseded";
    };

/**
 * Settlement is decided from canonical path evidence. This function returns a
 * transition decision only; persistence must record the actual status-axis
 * change as its own durable transition.
 */
export function decideProvisionalSettlement(
  state: SubjectStateWrite,
  conversation: NativeLiveConversation,
): ProvisionalSettlementDecision {
  const status = state.envelope.status;
  if (
    status.settlementStatus !== "unsettled"
    || status.validityStatus !== "valid"
  ) {
    return { action: "keep", reason: "already_resolved" };
  }

  const scope = state.envelope.scope;
  if (
    scope.applicability !== "path"
    || scope.conversationId !== conversation.id
    || !scope.pathHeadMessageId
  ) {
    return { action: "invalidate", reason: "path_superseded" };
  }

  const path = canonicalPathToHead(conversation);
  const index = path.findIndex(
    (message) => message.id === scope.pathHeadMessageId,
  );

  if (index < 0) {
    return { action: "invalidate", reason: "path_superseded" };
  }

  const laterMessages = path.slice(index + 1);
  if (laterMessages.some((message) => message.role === "user")) {
    return { action: "settle", reason: "user_continued_current_path" };
  }

  return { action: "keep", reason: "awaiting_user_continuation" };
}
