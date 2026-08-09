import {
  useWebApiClient,
} from "../api/useWebApiClient";
import {
  SystemConnectionsPageContent,
} from "./SystemConnectionsPageContent";

export function SystemConnectionsPage() {
  const api = useWebApiClient();

  return (
    <SystemConnectionsPageContent
      api={api}
    />
  );
}
