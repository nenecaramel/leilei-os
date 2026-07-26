import { useWebApiClient } from "../api/useWebApiClient";
import { useSettings } from "../settings/SettingsProvider";
import { TaskPageContent } from "./TaskPage";

export function TaskPage() {
  const api = useWebApiClient();
  const { settings } = useSettings();

  return <TaskPageContent api={api} settings={settings} />;
}
