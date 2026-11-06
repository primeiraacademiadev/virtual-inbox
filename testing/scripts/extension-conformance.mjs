/**
 * End-to-end conformance smoke for an independently authored ESM provider.
 * This intentionally starts only test HTTP fixtures: the extension itself
 * still uses VI's existing listener and the ordinary functional public API.
 * Run after npm run build:server.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { ExtensionHost } from "../../dist/src/extension-host.js";
import { tryExtensionRequest } from "../../dist/src/http/extension-request.js";

const captures = [];
const host = new ExtensionHost();
let api;
let demo;
const open = async handler => {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, base: `http://127.0.0.1:${address.port}` };
};
const close = async item => {
  if (!item) return;
  item.server.closeAllConnections();
  await new Promise((resolve, reject) => item.server.close(e => e ? reject(e) : resolve()));
};
try {
  api = await open((req, res) => {
    const respond = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.method === "GET" && req.url === "/api/extensions") {
      return respond(200, host.registry());
    }
    if (req.method !== "POST" || req.url !== "/api/sms/ingestions") {
      return respond(404, { error: "not found" });
    }
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      captures.push(payload);
      return respond(201, {
        id: "capture-" + captures.length, channel: "sms", sequence: captures.length,
        from: payload.from, originalRecipient: payload.to, body: payload.body,
        destinationId: "synthetic-inbox",
      });
    });
  });

  process.env.VI_EXAMPLE_PUBLIC_API_URL = api.base;
  await host.loadFiles(["./examples/extensions/provider-adapter.mjs"]);
  assert.deepEqual(host.errors, [], "The independent ESM provider must load");
  assert.equal(host.registry().length, 1);
  const published = host.registry()[0];
  assert.equal(published.id, "example-provider");
  assert.equal(published.state, "active");
  assert.equal(published.documentation, "/wiki/en/extensions.md");
  assert.deepEqual(published.routes.map(r => r.path),
    ["/provider/status", "/provider/messages"]);

  demo = await open((req, res) => {
    // Simulates the existing VI /demo physical audience mapping with
    // precisely the same HTTP adapter that VI uses in production.
    const logical = (req.url ?? "/").replace(/^\/demo(?=\/)/, "");
    void tryExtensionRequest(req, res, host, "demo", logical).then(handled => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    }).catch(error => {
      res.writeHead(500);
      res.end(error.message);
    });
  });

  const post = (path, token, body) => fetch(demo.base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify(body),
  });
  const input = { sender: "synthetic-sender", recipient: "+351912345678", text: "example payload" };
  const rejected = await post("/demo/provider/messages", "invalid-token", input);
  assert.equal(rejected.status, 401);
  assert.equal(captures.length, 0, "Pre-capture rejection must not store messages");

  const invalid = await post("/demo/provider/messages", "Bearer synthetic-provider-key", {});
  assert.equal(invalid.status, 400);
  assert.equal(captures.length, 0);

  const accepted = await post("/demo/provider/messages", "Bearer synthetic-provider-key", input);
  assert.equal(accepted.status, 202);
  assert.equal(accepted.headers.get("x-provider-adapter"), "example");
  assert.deepEqual(await accepted.json(), { accepted: true, reference: "capture-1" });
  assert.deepEqual(captures, [{
    from: input.sender, to: input.recipient, body: input.text,
  }]);

  const healthy = await fetch(demo.base + "/demo/provider/status", {
    headers: { Authorization: "Bearer synthetic-provider-key" },
  });
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { provider: "synthetic", ready: true });
  const missing = await fetch(demo.base + "/demo/missing");
  assert.equal(missing.status, 404);

  const registry = await (await fetch(api.base + "/api/extensions")).json();
  assert.equal(registry[0].metrics.count, 4);
  assert.equal(registry[0].metrics.errors, 2);
  assert.deepEqual(registry[0].routes[1].publicPaths, [
    "/demo/provider/messages", "/provider/messages (dedicated demo listener)",
  ]);
  assert.equal(registry[0].capabilities.includes("sms-sender"), true);
  console.log("Independent ESM provider conformance passed");
} finally {
  delete process.env.VI_EXAMPLE_PUBLIC_API_URL;
  await close(demo);
  await close(api);
}
