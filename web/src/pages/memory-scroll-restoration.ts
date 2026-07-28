export type MemoryScrollStorage = Pick<
  Storage,
  "getItem" | "setItem"
>;

const KEY_PREFIX = "leilei-os:memory-scroll:";

export function getMemoryScrollStorage(
  target: Pick<Window, "sessionStorage">,
): MemoryScrollStorage | null {
  try {
    return target.sessionStorage;
  } catch {
    return null;
  }
}

export function saveMemoryScrollPosition(
  storage: MemoryScrollStorage | null,
  listUrl: string,
  position: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      `${KEY_PREFIX}${listUrl}`,
      String(Math.max(0, Math.round(position))),
    );
  } catch {
    // Scroll restoration is optional when browser storage is unavailable.
  }
}

export function readMemoryScrollPosition(
  storage: MemoryScrollStorage | null,
  listUrl: string,
): number | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(`${KEY_PREFIX}${listUrl}`);
    if (value === null) return null;
    const position = Number(value);
    return Number.isFinite(position) && position >= 0
      ? position
      : null;
  } catch {
    return null;
  }
}
