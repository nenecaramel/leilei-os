import {
  normalizeSystemBuildInfo,
} from "./build-metadata";

export const SYSTEM_BUILD_INFO =
  normalizeSystemBuildInfo({
    version: __LEILEI_VERSION__,
    commit: __LEILEI_COMMIT__,
    mode: __LEILEI_MODE__,
  });
