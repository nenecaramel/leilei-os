import { useWebApiClient } from "../api/useWebApiClient";
import { TaskPageContent } from "./TaskPage";

export function TaskPage() {
  const api = useWebApiClient();
  return <TaskPageContent api={api} />;
}
