import { Router, type RequestHandler } from "express";
import { GlobalSearchError, type GlobalSearchInput, type GlobalSearchResult } from "../domains/global-search/global-search-service.js";

export type GlobalSearchApiDependencies = { globalSearchService: { search(input: GlobalSearchInput): Promise<GlobalSearchResult> } };
export function createGlobalSearchApiRouter(dependencies: GlobalSearchApiDependencies): Router {
  const router = Router();
  router.get("/", createGlobalSearchApiHandler(dependencies));
  return router;
}
export function createGlobalSearchApiHandler(dependencies: GlobalSearchApiDependencies): RequestHandler {
  return async (request, response) => {
    response.set("Cache-Control", "private, no-store");
    response.set("Pragma", "no-cache");
    if (!request.webUserId) { response.status(401).json({ success:false,error:{code:"UNAUTHORIZED",message:"Web API authentication is required."} }); return; }
    try {
      const parsed = parseGlobalSearchQuery(request.query);
      const data=await dependencies.globalSearchService.search({ userId:request.webUserId, ...parsed });
      response.json({success:true,data});
    } catch(error) {
      const unavailable=error instanceof GlobalSearchError&&(error.code==="USER_DISABLED"||error.code==="USER_NOT_FOUND");
      response.status(unavailable?403: error instanceof GlobalSearchError?400:500).json({success:false,error:{code:unavailable?"GLOBAL_SEARCH_UNAVAILABLE":error instanceof GlobalSearchError?"INVALID_GLOBAL_SEARCH":"GLOBAL_SEARCH_FAILED",message:unavailable?"Global search is unavailable.":error instanceof GlobalSearchError?"The global search request is invalid.":"Global search is temporarily unavailable."}});
    }
  };
}

const ALLOWED_QUERY_KEYS = new Set(["query", "modules", "scope", "mode", "author", "date_from", "date_to", "limit", "cursor"]);

function parseGlobalSearchQuery(query: Record<string, unknown>): Omit<GlobalSearchInput, "userId"> {
  if (Object.keys(query).some((key) => !ALLOWED_QUERY_KEYS.has(key))) invalidQuery();
  const scalar = (name: string): string | undefined => {
    const value = query[name];
    if (value === undefined) return undefined;
    if (typeof value !== "string") invalidQuery();
    return value;
  };
  const modulesValue = query.modules;
  let modules: string[] | undefined;
  if (typeof modulesValue === "string") {
    modules = modulesValue.split(",");
  } else if (Array.isArray(modulesValue)) {
    if (modulesValue.length === 0 || modulesValue.some((value) => typeof value !== "string")) invalidQuery();
    modules = modulesValue as string[];
  } else if (modulesValue !== undefined) {
    invalidQuery();
  }
  if (modules?.some((module) => module.length === 0 || module.includes(","))) invalidQuery();
  const limitText = scalar("limit");
  if (limitText !== undefined && !/^(?:[1-9]|1\d|2[0-5])$/.test(limitText)) invalidQuery();
  return {
    query: scalar("query") ?? "",
    modules,
    scope: scalar("scope"),
    mode: scalar("mode"),
    author: scalar("author"),
    date_from: scalar("date_from"),
    date_to: scalar("date_to"),
    limit: limitText === undefined ? undefined : Number(limitText),
    cursor: scalar("cursor"),
  };
}

function invalidQuery(): never {
  throw new GlobalSearchError("INVALID_GLOBAL_SEARCH", "The global search request is invalid.");
}
