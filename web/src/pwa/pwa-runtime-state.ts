import { createPwaStateStore } from "./pwa-state";

export const pwaStateStore = createPwaStateStore({
  online:
    typeof navigator === "undefined"
      ? true
      : navigator.onLine,
});
