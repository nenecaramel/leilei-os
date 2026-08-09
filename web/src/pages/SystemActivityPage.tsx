import {
  useWebApiClient,
} from "../api/useWebApiClient";
import {
  SystemActivityPageContent,
} from "./SystemActivityPageContent";

export function SystemActivityPage() {
  const api = useWebApiClient();

  return (
    <SystemActivityPageContent
      api={api}
    />
  );
}
