import { useWebApiClient } from "../api/useWebApiClient";
import { MemoryPageContent } from "./MemoryPage";

export function MemoryPage() {
  const api = useWebApiClient();
  return <MemoryPageContent api={api} />;
}
