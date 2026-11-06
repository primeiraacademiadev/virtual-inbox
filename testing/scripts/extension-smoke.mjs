/**
 * Verify a real compiled ESM extension can be imported, registered and dispatched.
 * Run after npm run build:server (the SDK is emitted to dist/extension-sdk).
 */
import assert from "node:assert/strict";
import { ExtensionHost } from "../../dist/src/extension-host.js";

const host = new ExtensionHost();
await host.loadFiles(["./examples/extensions/ping.mjs"]);
assert.deepEqual(host.errors, [], "ESM extension failed to load");
assert.equal(host.list().length, 1);
assert.equal(host.list()[0].id, "example-ping");

const demo = await host.dispatch({ method: "GET", audience: "demo", path: "/ping" });
assert.deepEqual(demo?.response, {
  status: 200,
  headers: { "x-vi-example": "ping" },
  body: { ok: true },
});

const management = await host.dispatch({
  method: "GET", audience: "management", path: "/extensions/ping?name=CI",
});
assert.deepEqual(management?.response.body, { ok: true, query: "CI" });
assert.equal(await host.dispatch({ method: "GET", audience: "demo", path: "/missing" }), null);

console.log("Extension Host ESM smoke passed");
