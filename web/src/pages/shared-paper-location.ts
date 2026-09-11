import { getSafeGlobalSearchReturnTo } from "./global-search-location";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SharedPaperDetailLocation = {
  paperId: string | null;
  scope: "active" | "archived";
  returnTo: string;
};

export function createSharedPaperDetailLocation(
  paperId: string,
  scope: "active" | "archived",
  returnTo: string,
): string {
  const params = new URLSearchParams();
  params.set("paper", paperId);
  if (scope === "archived") params.set("scope", "archived");
  const safeReturnTo = getSafeSharedPaperReturnTo(returnTo);
  if (safeReturnTo !== "/shared-paper") params.set("returnTo", safeReturnTo);
  return `/shared-paper?${params.toString()}`;
}

export function getSharedPaperDetailLocation(search: string): SharedPaperDetailLocation {
  const params = new URLSearchParams(search);
  const candidate = params.get("paper")?.trim() ?? "";
  return {
    paperId: UUID.test(candidate) ? candidate : null,
    scope: params.get("scope") === "archived" ? "archived" : "active",
    returnTo: getSafeSharedPaperReturnTo(params.get("returnTo")),
  };
}

export function getSafeSharedPaperReturnTo(value: string | null): string {
  if (!value) return "/shared-paper";
  try {
    const parsed = new URL(value, "https://leilei-os.invalid");
    if (parsed.origin !== "https://leilei-os.invalid") return "/shared-paper";
    if (parsed.pathname === "/search") return getSafeGlobalSearchReturnTo(value);
    if (parsed.pathname !== "/shared-paper") return "/shared-paper";
    if ([...parsed.searchParams.keys()].length > 0) return "/shared-paper";
    return "/shared-paper";
  } catch {
    return "/shared-paper";
  }
}
