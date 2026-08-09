import {
  SYSTEM_BUILD_INFO,
} from "../system/build-info";
import {
  SystemAboutPageContent,
} from "./SystemAboutPageContent";

export function SystemAboutPage() {
  return (
    <SystemAboutPageContent
      buildInfo={SYSTEM_BUILD_INFO}
    />
  );
}
