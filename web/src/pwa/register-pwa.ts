import { registerSW } from "virtual:pwa-register";
import { pwaStateStore } from "./pwa-runtime-state";
import {
  createPwaUpdateChecker,
  PWA_UPDATE_INTERVAL_MS,
} from "./pwa-update-check";

let started = false;
let stopUpdateChecks: (() => void) | null = null;

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
    onRegisteredSW(swUrl, registration) {
      stopUpdateChecks?.();
      stopUpdateChecks = null;
      if (!registration) {
        return;
      }

      const checker = createPwaUpdateChecker({
        registration,
        swUrl,
        fetchImpl: window.fetch.bind(window),
        isOnline: () => navigator.onLine,
      });
      const intervalId = window.setInterval(() => {
        void checker.check();
      }, PWA_UPDATE_INTERVAL_MS);
      const checkOnFocus = () => {
        void checker.check();
      };
      const checkOnVisibility = () => {
        if (document.visibilityState === "visible") {
          void checker.check();
        }
      };
      const checkOnOnline = () => {
        void checker.check();
      };

      window.addEventListener("focus", checkOnFocus);
      document.addEventListener("visibilitychange", checkOnVisibility);
      window.addEventListener("online", checkOnOnline);
      stopUpdateChecks = () => {
        window.clearInterval(intervalId);
        window.removeEventListener("focus", checkOnFocus);
        document.removeEventListener("visibilitychange", checkOnVisibility);
        window.removeEventListener("online", checkOnOnline);
      };
    },
    onRegisterError(error) {
      console.error("PWA registration failed", error);
    },
  });

  pwaStateStore.setUpdateAction(async () => {
    await updateSW(true);
    window.location.reload();
  });

  const syncOnline = () => {
    pwaStateStore.setOnline(navigator.onLine);
  };

  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
}
