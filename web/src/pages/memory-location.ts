const MEMORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MEMORY_CATEGORIES = new Set([
  "profile",
  "preference",
  "goal",
  "project",
]);
const ALLOWED_LIST_PARAMETERS = new Set(["q", "category"]);

export type MemoryFilterCategory =
  | ""
  | "profile"
  | "preference"
  | "goal"
  | "project";

export type MemoryFilters = {
  q: string;
  category: MemoryFilterCategory;
};

export const EMPTY_MEMORY_FILTERS: MemoryFilters = {
  q: "",
  category: "",
};

export function readMemoryFilters(search: string): MemoryFilters {
  const parameters = new URLSearchParams(search);
  const category = parameters.get("category") ?? "";
  return {
    q: parameters.get("q") ?? "",
    category: MEMORY_CATEGORIES.has(category)
      ? category as Exclude<MemoryFilterCategory, "">
      : "",
  };
}

export function createMemoryListLocation(
  filters: MemoryFilters,
): string {
  const parameters = new URLSearchParams();
  const query = filters.q.trim();
  if (query) parameters.set("q", query);
  if (filters.category) {
    parameters.set("category", filters.category);
  }
  const search = parameters.toString();
  return search ? `/memory?${search}` : "/memory";
}

export function getMemoryDetailLocation(search: string): {
  memoryId: string | null;
  returnTo: string;
} {
  const parameters = new URLSearchParams(search);
  const candidate = parameters.get("memory")?.trim() ?? "";
  return {
    memoryId: MEMORY_ID_PATTERN.test(candidate) ? candidate : null,
    returnTo: getSafeMemoryReturnTo(parameters.get("returnTo")),
  };
}

export function createMemoryDetailLocation(
  memoryId: string,
  returnTo: string,
): string {
  const parameters = new URLSearchParams();
  parameters.set("memory", memoryId);
  parameters.set("returnTo", getSafeMemoryReturnTo(returnTo));
  return `/memory?${parameters.toString()}`;
}

export function getSafeMemoryReturnTo(value: string | null): string {
  if (!value) return "/memory";

  try {
    const parsed = new URL(value, "https://leilei-os.invalid");
    const keys = [...parsed.searchParams.keys()];
    if (
      parsed.origin !== "https://leilei-os.invalid" ||
      parsed.pathname !== "/memory" ||
      keys.some((key) => !ALLOWED_LIST_PARAMETERS.has(key)) ||
      parsed.searchParams.getAll("q").length > 1 ||
      parsed.searchParams.getAll("category").length > 1
    ) {
      return "/memory";
    }
    return createMemoryListLocation(
      readMemoryFilters(parsed.search),
    );
  } catch {
    return "/memory";
  }
}
