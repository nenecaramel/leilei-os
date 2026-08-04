import { useWebApiClient } from "../api/useWebApiClient";
import { GlobalSearchPageContent } from "./GlobalSearchPage";

export function GlobalSearchPage() {
  return <GlobalSearchPageContent api={useWebApiClient()} />;
}
