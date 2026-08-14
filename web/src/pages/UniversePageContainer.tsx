import { useWebApiClient } from "../api/useWebApiClient";
import { UniversePage as UniversePageContent } from "./UniversePage";

export function UniversePage() {
  return <UniversePageContent api={useWebApiClient()} />;
}
