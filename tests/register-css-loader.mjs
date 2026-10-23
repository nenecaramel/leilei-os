import { register } from "node:module";

// Asynchronous hooks, chained with tsx's own. Node 22 rejects a synchronous
// (registerHooks) load hook that forwards a CommonJS module tsx leaves to
// Node's CommonJS loader, because that module has no ESM source.
register("./css-loader-hooks.mjs", import.meta.url);
