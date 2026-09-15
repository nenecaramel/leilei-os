export type PwaState = {
  updateAvailable: boolean;
  online: boolean;
};

export type PwaStateStore = {
  getSnapshot(): PwaState;
  subscribe(listener: () => void): () => void;
  setUpdateAction(action: () => Promise<void>): void;
  markUpdateAvailable(): void;
  setOnline(online: boolean): void;
  acceptUpdate(): Promise<void>;
};

export function createPwaStateStore(
  initial: Partial<PwaState> = {},
): PwaStateStore {
  let state: PwaState = {
    updateAvailable: initial.updateAvailable ?? false,
    online: initial.online ?? true,
  };
  let updateAction: (() => Promise<void>) | null = null;
  const listeners = new Set<() => void>();

  const publish = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setUpdateAction(action) {
      updateAction = action;
    },
    markUpdateAvailable() {
      if (state.updateAvailable) {
        return;
      }
      state = {
        ...state,
        updateAvailable: true,
      };
      publish();
    },
    setOnline(online) {
      if (state.online === online) {
        return;
      }
      state = {
        ...state,
        online,
      };
      publish();
    },
    async acceptUpdate() {
      if (!state.updateAvailable) {
        return;
      }

      state = {
        ...state,
        updateAvailable: false,
      };
      publish();

      if (!updateAction) {
        return;
      }

      try {
        await updateAction();
      } catch (error) {
        state = {
          ...state,
          updateAvailable: true,
        };
        publish();
        throw error;
      }
    },
  };
}
