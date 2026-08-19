export const PWA_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const PWA_UPDATE_THROTTLE_MS = 60 * 1000;

type PwaRegistration = Pick<
  ServiceWorkerRegistration,
  "installing" | "update"
>;

export type PwaUpdateCheckerInput = {
  registration: PwaRegistration | undefined;
  swUrl: string;
  fetchImpl?: typeof fetch;
  isOnline?: () => boolean;
  now?: () => number;
  throttleMs?: number;
};

export function createPwaUpdateChecker(input: PwaUpdateCheckerInput) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const isOnline = input.isOnline ?? (() =>
    typeof navigator === "undefined" || navigator.onLine !== false);
  const now = input.now ?? Date.now;
  const throttleMs = input.throttleMs ?? PWA_UPDATE_THROTTLE_MS;
  let lastCheckAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  const check = async (): Promise<void> => {
    if (inFlight) {
      return inFlight;
    }
    if (!input.registration || input.registration.installing || !isOnline()) {
      return;
    }

    const currentTime = now();
    if (
      lastCheckAt !== null &&
      currentTime - lastCheckAt < throttleMs
    ) {
      return;
    }
    lastCheckAt = currentTime;

    const operation = (async () => {
      try {
        const response = await fetchImpl(input.swUrl, {
          cache: "no-store",
          headers: {
            "cache-control": "no-cache",
            cache: "no-store",
          },
        });
        if (response.status !== 200) {
          return;
        }
        if (input.registration!.installing) {
          return;
        }
        await input.registration!.update();
      } catch {
        // Update probes are best-effort. A later foreground or periodic
        // trigger can retry after the throttle window.
      }
    })();
    inFlight = operation;
    try {
      await operation;
    } finally {
      inFlight = null;
    }
  };

  return {
    check,
  };
}
