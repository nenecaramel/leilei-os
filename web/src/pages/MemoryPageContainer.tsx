import { useWebApiClient } from "../api/useWebApiClient";
import { useSettings } from "../settings/SettingsProvider";
import { MemoryPageContent } from "./MemoryPage";

export function MemoryPage() {
  const api = useWebApiClient();
  const { settings } = useSettings();
  return <MemoryPageContent api={api} settings={settings} />;
}
