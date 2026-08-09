import { useWebApiClient } from "../api/useWebApiClient";
import { DiaryPageContent } from "./DiaryPage";

export function DiaryPage() {
  const api = useWebApiClient();
  return <DiaryPageContent api={api} />;
}
