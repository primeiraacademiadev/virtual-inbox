import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../dist/index.js";

const request = (path, method = "GET", audience = "demo", extras = {}) =>
  ({ path, method, audience, ...extras });

test("route registration, audiences, params and query are resolved", async () => {
  const app = createApp();
  app.get("/items/{itemId}", (ctx) => {
    ctx.response.status = 200;
    ctx.response.body = { id: ctx.params.itemId, tag: ctx.query.tag };
  });
  app.get("/items/{itemId}", (ctx) => {
    ctx.response.status = 200;
    ctx.response.body = { admin: ctx.params.itemId };
  }, { audience: "management" });
  assert.equal(app.routes().length, 2);
  assert.equal(app.routes()[0].audience, "demo");
  assert.deepEqual(await app.dispatch(request("/items/%C3%A9?tag=ok")), {
    status: 200, headers: {}, body: { id: "é", tag: "ok" },
  });
  assert.deepEqual((await app.dispatch(request("/items/42", "GET", "management"))).body, { admin: "42" });
  assert.equal(await app.dispatch(request("/missing")), null);
  assert.equal(await app.dispatch(request("/items/42", "POST")), null);
});

test("onion middleware runs before and after and may replace result", async () => {
  const order = [];
  const app = createApp();
  app.use(async (ctx, next) => {
    order.push("outer-in");
    await next();
    order.push("outer-out");
    ctx.response.body = { replaced: true };
  });
  app.use("/items", async (ctx, next) => {
    order.push("inner-in");
    await next();
    order.push("inner-out");
    ctx.response.headers["x-middleware"] = "yes";
  });
  app.post("/items", (ctx) => {
    order.push("handler");
    ctx.response.status = 201;
    ctx.response.body = { original: true };
  });
  assert.deepEqual(await app.dispatch(request("/items", "POST")), {
    status: 201, headers: { "x-middleware": "yes" }, body: { replaced: true },
  });
  assert.deepEqual(order, ["outer-in", "inner-in", "handler", "inner-out", "outer-out"]);
});

test("middleware short-circuits without calling handler", async () => {
  const app = createApp();
  let called = false;
  app.use("/secure", async (ctx) => {
    ctx.response.status = 401;
    ctx.response.body = { error: "unauthorized" };
  });
  app.get("/secure", () => { called = true; });
  assert.deepEqual((await app.dispatch(request("/secure"))).body, { error: "unauthorized" });
  assert.equal(called, false);
});

test("middleware is limited by path segment and extension route match", async () => {
  const app = createApp();
  let runs = 0;
  app.use("/api", async (_, next) => { runs++; await next(); });
  app.get("/api/test", ctx => { ctx.response.status = 200; });
  app.get("/apix/test", ctx => { ctx.response.status = 200; });
  await app.dispatch(request("/api/test"));
  await app.dispatch(request("/apix/test"));
  await app.dispatch(request("/other"));
  assert.equal(runs, 1);
});

test("duplicate, ambiguous and unsupported routes are rejected", () => {
  const app = createApp();
  app.get("/things/{id}", () => {});
  assert.throws(() => app.get("/things/{name}", () => {}), /Ambiguous/);
  assert.throws(() => app.get("/things/fixed", () => {}), /Ambiguous/);
  assert.throws(() => app.get("/things/*", () => {}), /Unsupported/);
  assert.throws(() => app.get("relative", () => {}), /canonical/);
  assert.throws(() => app.post("/x", null), /function/);
  assert.throws(() => app.use("/x/{id}", async () => {}), /prefix/);
  assert.equal(app.routes().length, 1);
});

test("async rejection propagates for Host to map; no swallowed errors", async () => {
  const app = createApp();
  app.get("/fail", async () => { throw new Error("provider-failed"); });
  await assert.rejects(app.dispatch(request("/fail")), /provider-failed/);
});

test("invalid request encoding and invalid response status are rejected", async () => {
  const app = createApp();
  app.get("/x/{id}", ctx => { ctx.response.status = 700; });
  await assert.rejects(app.dispatch(request("/x/%GG")), /encoding/);
  await assert.rejects(app.dispatch(request("/x/ok")), /status/);
});

test("request-local state is fresh for concurrent dispatches", async () => {
  const app = createApp();
  app.use(async (ctx, next) => {
    ctx.state.tag = ctx.request.body?.tag;
    await next();
  });
  app.post("/work", async ctx => {
    await Promise.resolve();
    ctx.response.status = 200;
    ctx.response.body = { tag: ctx.state.tag };
  });
  const [a, b] = await Promise.all([
    app.dispatch(request("/work", "POST", "demo", { body: { tag: "A" } })),
    app.dispatch(request("/work", "POST", "demo", { body: { tag: "B" } })),
  ]);
  assert.equal(a.body.tag, "A");
  assert.equal(b.body.tag, "B");
});

test("next called twice is rejected", async () => {
  const app = createApp();
  app.use(async (_, next) => { await next(); await next(); });
  app.get("/x", ctx => { ctx.response.status = 200; });
  await assert.rejects(app.dispatch(request("/x")), /more than once/);
});
