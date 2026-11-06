import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createApp } from "../extension-sdk/src/index.js";
import { ExtensionHost } from "../src/extension-host.js";
import { tryExtensionRequest } from "../src/http/extension-request.js";

async function withHost(
  handler: (req: IncomingMessage, res: ServerResponse, host: ExtensionHost) => Promise<void>,
  action: (url: string) => Promise<void>,
) {
  const app = createApp();
  app.post("/echo", ctx => {
    ctx.response.status = 201;
    ctx.response.body = {
      request: ctx.request.body ?? null,
      from: ctx.request.headers.authorization ?? null,
      userAgent: ctx.request.headers["user-agent"] ?? null,
    };
    ctx.response.headers["x-extension-result"] = "ok";
  });
  app.get("/empty", ctx => { ctx.response.status = 204; });
  app.get("/failure", () => { throw new Error("unexpected confidential error"); });
  app.get("/invalid-response", ctx => {
    ctx.response.status = 200;
    ctx.response.headers["set-cookie"] = "not allowed";
  });
  const host = new ExtensionHost();
  host.register({ id: "test-http", version: "1.0.0", app });
  const server = createServer((req, res) => {
    void handler(req, res, host).catch(error => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(String(error));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  }
}

test("extension HTTP adapter preserves JSON request, authentication header and response", async () => {
  await withHost(async (req, res, host) => {
    if (!(await tryExtensionRequest(req, res, host, "demo", req.url ?? "/"))) {
      res.writeHead(404);
      res.end();
    }
  }, async base => {
    const response = await fetch(base + "/echo?code=abc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer synthetic-provider-token",
        "user-agent": "fake-provider-test",
      },
      body: JSON.stringify({ text: "Hello" }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-extension-result"), "ok");
    assert.deepEqual(await response.json(), {
      request: { text: "Hello" },
      from: "Bearer synthetic-provider-token",
      userAgent: "fake-provider-test",
    });
  });
});

test("adapter leaves unmatched requests untouched and does not consume their body", async () => {
  await withHost(async (req, res, host) => {
    const claimed = await tryExtensionRequest(req, res, host, "demo", req.url ?? "/");
    if (!claimed) {
      let payload = "";
      for await (const chunk of req) payload += chunk;
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(payload);
    }
  }, async base => {
    const response = await fetch(base + "/not-owned", {
      method: "POST", body: "body untouched",
    });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "body untouched");
  });
});

test("adapter emits an empty 204 body without throwing", async () => {
  await withHost(async (req, res, host) => {
    await tryExtensionRequest(req, res, host, "demo", req.url ?? "/");
  }, async base => {
    const response = await fetch(base + "/empty");
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  });
});

test("adapter maps throwing handlers and rejected response headers to safe 502", async () => {
  await withHost(async (req, res, host) => {
    await tryExtensionRequest(req, res, host, "demo", req.url ?? "/");
  }, async base => {
    for (const route of ["/failure", "/invalid-response"]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 502);
      const payload = await response.json() as Record<string, string>;
      assert.equal(payload.errorCode, "EXTENSION_FAILED");
      assert.doesNotMatch(JSON.stringify(payload), /confidential|set-cookie/);
    }
  });
});
