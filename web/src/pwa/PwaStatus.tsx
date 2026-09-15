import {
  useSyncExternalStore,
} from "react";
import type {
  PwaStateStore,
} from "./pwa-state";

export function PwaStatus({
  store,
}: {
  store: PwaStateStore;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  if (state.online && !state.updateAvailable) {
    return null;
  }

  return (
    <div
      className="pwa-status"
      data-pwa-status
      aria-live="polite"
    >
      {!state.online ? (
        <div className="pwa-status__item pwa-status__offline">
          暂时离线
        </div>
      ) : null}

      {state.updateAvailable ? (
        <div className="pwa-status__item pwa-status__update">
          <span>Leilei OS 有新版本</span>
          <button
            type="button"
            className="pwa-status__update-button"
            data-pwa-update
            onClick={() => {
              void store.acceptUpdate();
            }}
          >
            刷新
          </button>
        </div>
      ) : null}
    </div>
  );
}
