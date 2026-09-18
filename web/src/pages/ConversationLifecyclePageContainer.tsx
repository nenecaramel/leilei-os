import { useWebApiClient } from "../api/useWebApiClient";
import { ConversationLifecyclePageContent } from "./ConversationLifecyclePage";

export function ConversationLifecyclePage() {
  return <ConversationLifecyclePageContent api={useWebApiClient()} />;
}
