export type DiaryScrollStorage = Pick<
  Storage,
  "getItem" | "setItem"
>;

const KEY_PREFIX = "leilei-os:diary-scroll:";

export function getDiaryScrollStorage(
  target: Pick<Window, "sessionStorage">,
): DiaryScrollStorage | null {
  try {
    return target.sessionStorage;
  } catch {
    return null;
  }
}

export function saveDiaryScrollPosition(
  storage: DiaryScrollStorage | null,
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
    // Browser storage may be disabled or full. Scroll restoration is optional.
  }
}

export function readDiaryScrollPosition(
  storage: DiaryScrollStorage | null,
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
