import { useWebApiClient } from "../api/useWebApiClient";
import { ConversationArchivePageContent } from "./ConversationArchivePage";

export function ConversationArchivePage() {
  return <ConversationArchivePageContent api={useWebApiClient()} />;
}
