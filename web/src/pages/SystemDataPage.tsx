import {
  useWebApiClient,
} from "../api/useWebApiClient";
import {
  SystemDataPageContent,
} from "./SystemDataPageContent";

export function SystemDataPage() {
  const api = useWebApiClient();

  return (
    <SystemDataPageContent api={api} />
  );
}
