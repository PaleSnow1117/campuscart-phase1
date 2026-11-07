import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
globalThis.__handlers = [];
globalThis.Deno = { env: { get: (k) => process.env[k] }, serve: (h) => { globalThis.__handlers.push(h); } };
