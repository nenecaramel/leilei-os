export type DiaryFilters = {
  q: string;
  tag: string;
  mood: string;
  dateFrom: string;
  dateTo: string;
};

export const EMPTY_DIARY_FILTERS: DiaryFilters = {
  q: "",
  tag: "",
  mood: "",
  dateFrom: "",
  dateTo: "",
};

const DIARY_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function readDiaryFilters(search: string): DiaryFilters {
  const parameters = new URLSearchParams(search);
  return {
    q: parameters.get("q") ?? "",
    tag: parameters.get("tag") ?? "",
    mood: parameters.get("mood") ?? "",
    dateFrom: parameters.get("date_from") ?? "",
    dateTo: parameters.get("date_to") ?? "",
  };
}

export function getDiaryDetailLocation(search: string): {
  diaryId: string | null;
  returnTo: string;
} {
  const parameters = new URLSearchParams(search);
  const candidate = parameters.get("diary")?.trim() ?? "";
  return {
    diaryId: DIARY_ID_PATTERN.test(candidate) ? candidate : null,
    returnTo: getSafeDiaryReturnTo(parameters.get("returnTo")),
  };
}

export function createDiaryDetailLocation(
  diaryId: string,
  returnTo: string,
): string {
  const parameters = new URLSearchParams();
  parameters.set("diary", diaryId);
  parameters.set("returnTo", getSafeDiaryReturnTo(returnTo));
  return `/diary?${parameters.toString()}`;
}

export function getSafeDiaryReturnTo(value: string | null): string {
  if (!value) return "/diary";

  try {
    const parsed = new URL(value, "https://leilei-os.invalid");
    if (
      parsed.origin !== "https://leilei-os.invalid" ||
      parsed.pathname !== "/diary" ||
      parsed.searchParams.has("diary") ||
      parsed.searchParams.has("returnTo")
    ) {
      return "/diary";
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/diary";
  }
}
