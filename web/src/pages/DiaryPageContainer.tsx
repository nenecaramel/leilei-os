import { useWebApiClient } from "../api/useWebApiClient";
import { useSettings } from "../settings/SettingsProvider";
import { DiaryPageContent } from "./DiaryPage";

export function DiaryPage() {
  const api = useWebApiClient();
  const { settings } = useSettings();
  return <DiaryPageContent api={api} settings={settings} />;
}
