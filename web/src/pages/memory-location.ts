const MEMORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MEMORY_CATEGORIES = new Set([
  "profile",
  "preference",
  "goal",
  "project",
]);
const ALLOWED_LIST_PARAMETERS = new Set(["q", "category", "tag"]);

export type MemoryFilterCategory =
  | ""
  | "profile"
  | "preference"
  | "goal"
  | "project";

export type MemoryFilters = {
  q: string;
  category: MemoryFilterCategory;
  tag: string;
};

export const EMPTY_MEMORY_FILTERS: MemoryFilters = {
  q: "",
  category: "",
  tag: "",
};

export function readMemoryFilters(search: string): MemoryFilters {
  const parameters = new URLSearchParams(search);
  const category = parameters.get("category") ?? "";
  return {
    q: parameters.get("q") ?? "",
    category: MEMORY_CATEGORIES.has(category)
      ? category as Exclude<MemoryFilterCategory, "">
      : "",
    tag: parameters.get("tag") ?? "",
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
  const tag = filters.tag.normalize("NFC").trim();
  if (tag) parameters.set("tag", tag);
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

export function createMemoryArchiveLocation(
  returnTo: string,
): string {
  const parameters = new URLSearchParams();
  parameters.set("view", "archived");
  parameters.set("returnTo", getSafeMemoryReturnTo(returnTo));
  return `/memory?${parameters.toString()}`;
}

export function createArchivedMemoryDetailLocation(
  memoryId: string,
  returnTo: string,
): string {
  const parameters = new URLSearchParams();
  parameters.set("archivedMemory", memoryId);
  parameters.set("returnTo", getSafeMemoryArchiveReturnTo(returnTo));
  return `/memory?${parameters.toString()}`;
}

export function getArchivedMemoryDetailLocation(search: string): {
  memoryId: string | null;
  returnTo: string;
} {
  const parameters = new URLSearchParams(search);
  const candidate = parameters.get("archivedMemory")?.trim() ?? "";
  return {
    memoryId: MEMORY_ID_PATTERN.test(candidate) ? candidate : null,
    returnTo: getSafeMemoryArchiveReturnTo(parameters.get("returnTo")),
  };
}

export function getMemoryArchiveLocation(search: string): {
  archived: boolean;
  returnTo: string;
} {
  const parameters = new URLSearchParams(search);
  return {
    archived:
      parameters.get("view") === "archived" &&
      !parameters.has("memory") &&
      !parameters.has("archivedMemory"),
    returnTo: getSafeMemoryReturnTo(parameters.get("returnTo")),
  };
}

export function getSafeMemoryArchiveReturnTo(
  value: string | null,
): string {
  if (!value) return createMemoryArchiveLocation("/memory");

  try {
    const parsed = new URL(value, "https://leilei-os.invalid");
    const keys = [...parsed.searchParams.keys()];
    if (
      parsed.origin !== "https://leilei-os.invalid" ||
      parsed.pathname !== "/memory" ||
      keys.some((key) => !["view", "returnTo"].includes(key)) ||
      parsed.searchParams.getAll("view").length !== 1 ||
      parsed.searchParams.get("view") !== "archived" ||
      parsed.searchParams.getAll("returnTo").length !== 1
    ) {
      return createMemoryArchiveLocation("/memory");
    }

    return createMemoryArchiveLocation(
      getSafeMemoryReturnTo(parsed.searchParams.get("returnTo")),
    );
  } catch {
    return createMemoryArchiveLocation("/memory");
  }
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
      parsed.searchParams.getAll("category").length > 1 ||
      parsed.searchParams.getAll("tag").length > 1
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
