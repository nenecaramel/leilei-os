import { registerSW } from "virtual:pwa-register";
import { pwaStateStore } from "./pwa-runtime-state";

let started = false;

export function startPwaRegistration(): void {
  if (started || typeof window === "undefined") {
    return;
  }

  started = true;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pwaStateStore.markUpdateAvailable();
    },
    onRegisterError(error) {
      console.error("PWA registration failed", error);
    },
  });

  pwaStateStore.setUpdateAction(() => updateSW(true));

  const syncOnline = () => {
    pwaStateStore.setOnline(navigator.onLine);
  };

  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
}
