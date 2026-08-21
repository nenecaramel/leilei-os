import { getSafeGlobalSearchReturnTo } from "./global-search-location";
import { getSafeUniverseNodeReturnTo } from "./universe/universe-location";

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

export function createDiaryArchiveLocation(returnTo: string): string {
  const parameters = new URLSearchParams();
  parameters.set("view", "archived");
  parameters.set("returnTo", getSafeDiaryReturnTo(returnTo));
  return `/diary?${parameters.toString()}`;
}

export function getDiaryArchiveLocation(search: string): {
  archived: boolean;
  returnTo: string;
} {
  const parameters = new URLSearchParams(search);
  return {
    archived:
      parameters.get("view") === "archived" &&
      !parameters.has("diary") &&
      !parameters.has("archivedDiary"),
    returnTo: getSafeDiaryReturnTo(parameters.get("returnTo")),
  };
}

export function createArchivedDiaryDetailLocation(
  diaryId: string,
  returnTo: string,
): string {
  const parameters = new URLSearchParams();
  parameters.set("archivedDiary", diaryId);
  parameters.set("returnTo", getSafeDiaryArchiveReturnTo(returnTo));
  return `/diary?${parameters.toString()}`;
}

export function getArchivedDiaryDetailLocation(search: string): {
  diaryId: string | null;
  returnTo: string;
} {
  const parameters = new URLSearchParams(search);
  const candidate = parameters.get("archivedDiary")?.trim() ?? "";
  return {
    diaryId: DIARY_ID_PATTERN.test(candidate) ? candidate : null,
    returnTo: getSafeDiaryArchiveReturnTo(parameters.get("returnTo")),
  };
}

export function getSafeDiaryArchiveReturnTo(value: string | null): string {
  if (!value) return createDiaryArchiveLocation("/diary");

  try {
    const parsed = new URL(value, "https://leilei-os.invalid");
    if (parsed.pathname === "/search") return getSafeGlobalSearchReturnTo(value);
    if (parsed.pathname === "/universe") return getSafeUniverseNodeReturnTo(value);
    const keys = [...parsed.searchParams.keys()];
    if (
      parsed.origin !== "https://leilei-os.invalid" ||
      parsed.pathname !== "/diary" ||
      keys.some((key) => !["view", "returnTo"].includes(key)) ||
      parsed.searchParams.getAll("view").length !== 1 ||
      parsed.searchParams.get("view") !== "archived" ||
      parsed.searchParams.getAll("returnTo").length !== 1
    ) {
      return createDiaryArchiveLocation("/diary");
    }
    return createDiaryArchiveLocation(
      getSafeDiaryReturnTo(parsed.searchParams.get("returnTo")),
    );
  } catch {
    return createDiaryArchiveLocation("/diary");
  }
}

export function getSafeDiaryReturnTo(value: string | null): string {
  if (!value) return "/diary";

  try {
    const parsed = new URL(value, "https://leilei-os.invalid");
    if (parsed.pathname === "/search") return getSafeGlobalSearchReturnTo(value);
    if (parsed.pathname === "/universe") return getSafeUniverseNodeReturnTo(value);
    if (
      parsed.origin !== "https://leilei-os.invalid" ||
      parsed.pathname !== "/diary" ||
      [...parsed.searchParams.keys()].some(
        (key) => !["q", "tag", "mood", "date_from", "date_to"].includes(key),
      ) ||
      parsed.searchParams.getAll("q").length > 1 ||
      parsed.searchParams.getAll("tag").length > 1 ||
      parsed.searchParams.getAll("mood").length > 1 ||
      parsed.searchParams.getAll("date_from").length > 1 ||
      parsed.searchParams.getAll("date_to").length > 1
    ) {
      return "/diary";
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/diary";
  }
}
