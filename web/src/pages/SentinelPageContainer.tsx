import { useWebApiClient } from "../api/useWebApiClient";
import { SentinelPageContent } from "./SentinelPage";

export function SentinelPage() {
  const api = useWebApiClient();
  return <SentinelPageContent api={api} />;
}
