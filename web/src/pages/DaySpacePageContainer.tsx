import { useWebApiClient } from "../api/useWebApiClient";
import { DaySpacePageContent } from "./DaySpacePage";
import { createDaySpaceApi } from "./day-space-api";

export function DaySpacePage() {
  return <DaySpacePageContent api={createDaySpaceApi(useWebApiClient())} />;
}
