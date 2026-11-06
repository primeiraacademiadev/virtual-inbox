import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { Sandbox } from "../src/core.js";
import { observe } from "../src/http/event-stream.js";
import { body, errorCode, json, sse } from "../src/http/server-helpers.js";
import { Fault } from "../src/domain-types.js";

async function listen(server: Server): Promise<{ url: string; close: () => Promise<void> }> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: "http://127.0.0.1:" + address.port,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()));
    },
  };
}

test("HTTP error classification retains precise domain codes and status fallbacks", () => {
  assert.equal(errorCode(404, "Inbox not found"), "INBOX_NOT_FOUND");
  assert.equal(errorCode(404, "Message not found"), "MESSAGE_NOT_FOUND");
  assert.equal(errorCode(400, "Invalid TTL"), "INVALID_TTL");
  assert.equal(errorCode(404, "Recipient expired"), "RECIPIENT_EXPIRED");
  assert.equal(errorCode(400, "Invalid certificate PEM"), "TLS_CERTIFICATE_INVALID");
  for (const [status, code] of [
    [413, "MESSAGE_TOO_LARGE"], [403, "FORBIDDEN"], [409, "CONFLICT"],
    [507, "CAPACITY_EXCEEDED"], [404, "RESOURCE_NOT_FOUND"],
    [400, "INVALID_REQUEST"], [500, "INTERNAL_ERROR"],
  ] as const) assert.equal(errorCode(status, "other error"), code);
});

test("HTTP helpers serialize JSON and SSE, parse empty/valid bodies and reject invalid JSON", async () => {
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        sse(res, "update", { ok: true }, "test:1");
        sse(res, "ignored", { ok: false });
        res.end();
      } else if (req.url === "/json") {
        json(res, 201, { status: "created" });
      } else {
        json(res, 200, await body(req));
      }
    } catch (error) {
      json(res, error instanceof Fault ? error.status : 500,
        { code: error instanceof Fault ? error.code : "INTERNAL_ERROR" });
    }
  });
  const { url, close } = await listen(server);
  try {
    const created = await fetch(url + "/json");
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { status: "created" });

    const events = await fetch(url + "/events");
    assert.match(await events.text(), /id: test:1\nevent: update\ndata: {"ok":true}\n\n/);

    const empty = await fetch(url + "/body", { method: "POST" });
    assert.deepEqual(await empty.json(), {});
    const valid = await fetch(url + "/body", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: 1 }) });
    assert.deepEqual(await valid.json(), { a: 1 });
    const invalid = await fetch(url + "/body", { method: "POST", body: "{not json}" });
    assert.equal(invalid.status, 400);
  } finally {
    await close();
  }
});

test("event stream replays prior logs, applies filters, emits live logs and releases observers on disconnect", async () => {
  const sandbox = new Sandbox(3);
  sandbox.log("smtp.connected");
  const matching = sandbox.log("smtp.session.connected", undefined, undefined, { smtpSessionId: "session-1" });
  sandbox.log("smtp.disconnected");
  const server = createServer((req, res) => observe(sandbox, req, res));
  const { url, close } = await listen(server);
  const controller = new AbortController();
  try {
    const response = await fetch(url + "/?type=smtp.session.connected", { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    assert.match(first, /session.initialized/);
    assert.match(first, /event: log/);
    assert.ok(first.includes("id: " + matching.id));

    sandbox.log("smtp.session.connected", undefined, undefined, { smtpSessionId: "session-2" });
    const next = decoder.decode((await reader.read()).value);
    assert.match(next, /event: log/);
    assert.ok(next.includes("session-2"));
    controller.abort();
    await reader.cancel().catch(() => {});
  } finally {
    controller.abort();
    await close();
  }
});

test("event stream signals log gap and run reset when replay cursor is obsolete", async () => {
  const sandbox = new Sandbox(2);
  for (let i = 0; i < 5; i++) sandbox.log("smtp.event", undefined, undefined, { i });
  const server = createServer((req, res) => observe(sandbox, req, res));
  const { url, close } = await listen(server);
  const controller = new AbortController();
  try {
    const response = await fetch(url + "/?after=unknown-run:1", { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const data = new TextDecoder().decode((await reader.read()).value);
    assert.match(data, /event: log.reset/);
    assert.match(data, /event: log/);
    controller.abort();
    await reader.cancel().catch(() => {});
  } finally {
    controller.abort();
    await close();
  }
});
