import { useWebApiClient } from "../api/useWebApiClient";
import { DashboardPageContent } from "./DashboardPage";

export function DashboardPage() {
  const api = useWebApiClient();
  return <DashboardPageContent api={api} />;
}
