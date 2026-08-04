import { useWebApiClient } from "../api/useWebApiClient";
import { useSettings } from "../settings/SettingsProvider";
import { DashboardPageContent } from "./DashboardPage";

export function DashboardPage() {
  const api = useWebApiClient();
  const { settings } = useSettings();
  return <DashboardPageContent api={api} settings={settings} />;
}
