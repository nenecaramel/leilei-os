import { useWebApiClient } from "../api/useWebApiClient";
import { MindPageContent } from "./MindPage";
export function MindPage() {
  return <MindPageContent api={useWebApiClient()} />;
}
