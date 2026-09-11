import { useWebApiClient } from "../api/useWebApiClient";
import { SharedPaperPageContent } from "./SharedPaperPage";

export function SharedPaperPage() {
  return <SharedPaperPageContent api={useWebApiClient()} />;
}
