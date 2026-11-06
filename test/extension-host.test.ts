import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../extension-sdk/src/index.js";
import { ExtensionHost, configuredExtensionFiles } from "../src/extension-host.js";

const request = (path: string, method = "GET", audience = "demo" as const) =>
  ({ method: method as "GET", path, audience });

function createModule(id: string, path: string, handler: (ctx: any) => void = (ctx) => {
  ctx.response.status = 200;
  ctx.response.body = { id };
}) {
  const app = createApp();
  app.get(path, handler);
  return { id, version: "1.0.0", app };
}

test("host registers a module atomically and invokes its SDK handler", async () => {
  const host = new ExtensionHost();
  host.register(createModule("sample", "/hello/{id}", (ctx) => {
    ctx.response.status = 201;
    ctx.response.body = { id: ctx.params.id, method: ctx.request.method };
  }));
  assert.equal(host.list().length, 1);
  assert.deepEqual(host.list()[0]?.routes.map((r) => r.path), ["/hello/{id}"]);
  assert.equal(host.hasRoute("demo", "GET", "/hello/42"), true);
  assert.equal(host.hasRoute("management", "GET", "/hello/42"), false);
  assert.deepEqual((await host.dispatch(request("/hello/42")))?.response, {
    status: 201, headers: {}, body: { id: "42", method: "GET" },
  });
  assert.equal(await host.dispatch(request("/unknown")), null);
});

test("core route and overlapping extension routes are rejected without partial publication", () => {
  const host = new ExtensionHost();
  const core = createModule("conflict-core", "/sms/messages");
  core.app.post("/sms/messages", () => {});
  assert.throws(() => host.register(core), /conflict/i);
  assert.equal(host.list().length, 0);
  host.register(createModule("first", "/hello/{id}"));
  assert.throws(() => host.register(createModule("second", "/hello/fixed")), /conflict/i);
  assert.equal(host.list().length, 1);
  assert.throws(() => host.register(createModule("first", "/elsewhere")), /Duplicate extension ID/);
});

test("reserved root namespaces and invalid metadata are rejected", () => {
  const host = new ExtensionHost();
  for (const path of ["/api/fake", "/demo/fake", "/admin/fake", "/"]) {
    const mod = createModule("reserved", path);
    assert.throws(() => host.register(mod), /Reserved VI route namespace/);
  }
  assert.throws(() => host.register(createModule("Bad Id", "/good")), /Invalid extension/);
  assert.equal(host.list().length, 0);
});

test("host guards response headers and payloads", async () => {
  const host = new ExtensionHost();
  host.register(createModule("bad-response", "/bad", (ctx) => {
    ctx.response.status = 200;
    ctx.response.headers["set-cookie"] = "token=secret";
  }));
  await assert.rejects(host.dispatch(request("/bad")), /Unsupported extension response header/);
});

test("a handler rejection is not swallowed by host", async () => {
  const host = new ExtensionHost();
  host.register(createModule("failure", "/fail", () => { throw Error("boom"); }));
  await assert.rejects(host.dispatch(request("/fail")), /boom/);
});

test("startup module paths are configured explicitly as JSON, no empty array fallback for invalid config", () => {
  assert.deepEqual(configuredExtensionFiles(undefined), []);
  assert.deepEqual(configuredExtensionFiles('["./test/test-extension.mjs"]'), ["./test/test-extension.mjs"]);
  assert.throws(() => configuredExtensionFiles("./foo.mjs"), /JSON array/);
  assert.throws(() => configuredExtensionFiles('{"a":1}'), /JSON array/);
  assert.throws(() => configuredExtensionFiles('[""]'), /JSON array/);
});

test("module load failure is diagnosed and does not discard healthy registrations", async () => {
  const host = new ExtensionHost();
  host.register(createModule("already-active", "/good"));
  await host.loadFiles(["./non-existent-extension.mjs"]);
  assert.equal(host.list().length, 1);
  assert.equal(host.errors.length, 1);
  assert.equal((await host.dispatch(request("/good")))?.response.status, 200);
});


test("only explicit bundled registration may claim the existing SMS sender route", () => {
  const host = new ExtensionHost();
  const createSender = () => {
    const app = createApp();
    app.post("/sms/messages", ctx => {
      ctx.response.status = 201;
      ctx.response.body = { captured: true };
    });
    return { id: "sms-native", version: "1.0.0", app };
  };
  assert.throws(() => host.register(createSender()), /conflict/i,
    "An optional module named sms-native cannot silently replace the core route");
  assert.equal(host.list().length, 0);
  host.registerNativeSms(createSender());
  assert.equal(host.hasRoute("demo", "POST", "/sms/messages"), true);
  assert.throws(() => host.register(createSender()), /Duplicate extension ID/);
  assert.throws(() => host.registerNativeSms(createModule("other", "/other")), /Expected bundled/);
  assert.equal(host.list().length, 1);
});
