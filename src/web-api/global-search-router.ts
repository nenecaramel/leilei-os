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
    if (!request.webUserId) { response.status(401).json({ success:false,error:{code:"UNAUTHORIZED",message:"Web API authentication is required."} }); return; }
    response.set("Cache-Control", "private, no-store");
    try {
      const one = (value: unknown) => typeof value === "string" ? value : undefined;
      const modules = typeof request.query.modules === "string" ? request.query.modules.split(",") : Array.isArray(request.query.modules) ? request.query.modules.filter((v):v is string=>typeof v==="string") : undefined;
      const limitText=one(request.query.limit); const limit=limitText===undefined?undefined:Number(limitText);
      const data=await dependencies.globalSearchService.search({ userId:request.webUserId, query:one(request.query.query) ?? "", modules, scope:one(request.query.scope), mode:one(request.query.mode), date_from:one(request.query.date_from), date_to:one(request.query.date_to), limit, cursor:one(request.query.cursor) });
      response.json({success:true,data});
    } catch(error) {
      const unavailable=error instanceof GlobalSearchError&&(error.code==="USER_DISABLED"||error.code==="USER_NOT_FOUND");
      response.status(unavailable?403: error instanceof GlobalSearchError?400:500).json({success:false,error:{code:unavailable?"GLOBAL_SEARCH_UNAVAILABLE":error instanceof GlobalSearchError?"INVALID_GLOBAL_SEARCH":"GLOBAL_SEARCH_FAILED",message:unavailable?"Global search is unavailable.":error instanceof GlobalSearchError?"The global search request is invalid.":"Global search is temporarily unavailable."}});
    }
  };
}
