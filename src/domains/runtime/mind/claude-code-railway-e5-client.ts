import { E5_DIMENSIONS } from "./claude-code-semantic-lsh.js";

/** Optional private Railway-to-Railway E5 query embedder.
 * Public API retains the old lexical path if the worker isn't deployed/ready.
 */
export class ClaudeCodeRailwayE5Client {
  constructor(private readonly endpoint:string,private readonly token:string) {
    const url=new URL(endpoint);
    if (!["http:","https:"].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || !token ||
        !(url.hostname.endsWith(".railway.internal") ||
          ["localhost","127.0.0.1","[::1]"].includes(url.hostname)))
      throw new Error("Invalid private E5 endpoint.");
  }
  async embedQuery(query:string):Promise<number[]> {
    const response=await fetch(this.endpoint.replace(/\/$/,"")+"/embed-query",{
      method:"POST",
      headers:{"authorization":`Bearer ${this.token}`,"content-type":"application/json"},
      body:JSON.stringify({query:query.slice(0,512)}),
      redirect:"error",signal:AbortSignal.timeout(500),
    });
    if(!response.ok)throw new Error("E5 worker unavailable.");
    const parsed:unknown=await response.json();
    if(!parsed || typeof parsed!=="object" || !("vector" in parsed) ||
        !Array.isArray(parsed.vector) || parsed.vector.length!==E5_DIMENSIONS ||
        parsed.vector.some(v=>typeof v!=="number" || !Number.isFinite(v)))
      throw new Error("Invalid E5 worker vector.");
    return parsed.vector as number[];
  }
}
