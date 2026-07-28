const MEMORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const ALLOWED_LIST_PARAMETERS = new Set(["q"]);

export function readMemorySearch(search: string): string {
  return new URLSearchParams(search).get("q") ?? "";
}

export function createMemoryListLocation(query: string): string {
  const parameters = new URLSearchParams();
  const normalized = query.trim();
  if (normalized) parameters.set("q", normalized);
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
      parsed.searchParams.getAll("q").length > 1
    ) {
      return "/memory";
    }
    return createMemoryListLocation(parsed.searchParams.get("q") ?? "");
  } catch {
    return "/memory";
  }
}
