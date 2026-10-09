export const DEFAULT_SEARCH_MODULES = ["diary", "todo", "universe", "mind"] as const;
export const SEARCH_MODULES = DEFAULT_SEARCH_MODULES;
const GLOBAL_SEARCH_QUERY_MAX_CODE_POINTS = 200;
export type SearchModule = typeof SEARCH_MODULES[number];
type SearchScope = "active" | "archived" | "all";
type SearchMode = "normal" | "phrase";
export type GlobalSearchFilters = {
  q: string;
  modules: SearchModule[];
  scope: SearchScope;
  mode: SearchMode;
  dateFrom: string;
  dateTo: string;
};
export const DEFAULT_GLOBAL_SEARCH_FILTERS: GlobalSearchFilters = {
  q: "",
  modules: [...DEFAULT_SEARCH_MODULES],
  scope: "active",
  mode: "normal",
  dateFrom: "",
  dateTo: "",
};

export function normalizeGlobalSearchQuery(value: string): string {
  return value.normalize("NFC").trim();
}

export function isGlobalSearchQueryWithinLimit(value: string): boolean {
  const normalized = normalizeGlobalSearchQuery(value);
  return [...normalized].length <= GLOBAL_SEARCH_QUERY_MAX_CODE_POINTS;
}

export function hasSearchableGlobalSearchQuery(value: string): boolean {
  const normalized = normalizeGlobalSearchQuery(value);
  return Boolean(normalized) && isGlobalSearchQueryWithinLimit(normalized);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const scopes = new Set<SearchScope>(["active", "archived", "all"]);
const modes = new Set<SearchMode>(["normal", "phrase"]);

export function readGlobalSearchFilters(search: string): GlobalSearchFilters {
  const params = new URLSearchParams(search);
  const modulesValue = params.get("modules");
  const modules = modulesValue?.split(",") ?? [...DEFAULT_SEARCH_MODULES];
  const uniqueModules = [...new Set(modules)];
  const modulesAreValid = uniqueModules.length > 0 && uniqueModules.every((module) => SEARCH_MODULES.includes(module as SearchModule));
  const validModules = modulesAreValid ? uniqueModules as SearchModule[] : [...DEFAULT_SEARCH_MODULES];
  const q = normalizeGlobalSearchQuery(params.get("q") ?? "");
  const scope = scopes.has(params.get("scope") as SearchScope)
    ? params.get("scope") as SearchScope
    : "active";
  const mode = modes.has(params.get("mode") as SearchMode)
    ? params.get("mode") as SearchMode
    : "normal";
  let dateFrom = validDate(params.get("date_from")) ? params.get("date_from")! : "";
  let dateTo = validDate(params.get("date_to")) ? params.get("date_to")! : "";
  if (dateFrom && dateTo && dateFrom > dateTo) { dateFrom = ""; dateTo = ""; }
  return {
    q,
    modules: SEARCH_MODULES.filter((module) => validModules.includes(module)),
    scope,
    mode,
    dateFrom,
    dateTo,
  };
}

export function createGlobalSearchLocation(filters: GlobalSearchFilters): string {
  const params = new URLSearchParams();
  const q = normalizeGlobalSearchQuery(filters.q);
  if (q) params.set("q", q);
  const modules = SEARCH_MODULES.filter((module) => filters.modules.includes(module));
  const isDefaultModuleSet =
    modules.length === DEFAULT_SEARCH_MODULES.length
    && DEFAULT_SEARCH_MODULES.every((module) => modules.includes(module));
  if (modules.length && !isDefaultModuleSet) params.set("modules", modules.join(","));
  if (filters.scope !== "active") params.set("scope", filters.scope);
  if (filters.mode !== "normal") params.set("mode", filters.mode);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  const search = params.toString();
  return search ? `/search?${search}` : "/search";
}

export function toggleGlobalSearchModule(
  filters: GlobalSearchFilters,
  module: SearchModule,
): GlobalSearchFilters {
  if (!filters.modules.includes(module)) {
    return { ...filters, modules: [...filters.modules, module] };
  }
  if (filters.modules.length === 1) return filters;
  return { ...filters, modules: filters.modules.filter((item) => item !== module) };
}

export function hasValidGlobalSearchDateRange(filters: GlobalSearchFilters): boolean {
  return !filters.dateFrom || !filters.dateTo || filters.dateFrom <= filters.dateTo;
}

export function getSafeGlobalSearchReturnTo(value: string | null): string {
  if (!value) return "/search";
  try {
    const parsed = new URL(value, "https://leilei-os.invalid");
    if (parsed.origin !== "https://leilei-os.invalid" || parsed.pathname !== "/search") return "/search";
    const allowed = new Set(["q", "modules", "scope", "mode", "date_from", "date_to"]);
    if ([...parsed.searchParams.keys()].some((key) => !allowed.has(key))) return "/search";
    if ([...allowed].some((key) => parsed.searchParams.getAll(key).length > 1)) return "/search";
    const filters = readGlobalSearchFilters(parsed.search);
    return isGlobalSearchQueryWithinLimit(filters.q) ? createGlobalSearchLocation(filters) : "/search";
  } catch {
    return "/search";
  }
}

function validDate(value: string | null): value is string {
  if (!value || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
