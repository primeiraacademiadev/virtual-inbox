/**
 * Reusable contract probes for any trusted embedded Extension SDK module.
 * Provider-specific tests should call this suite against an isolated Host.
 * These checks deliberately use public Host/SDK interfaces only.
 */
import assert from "node:assert/strict";
import { createApp, type ExtensionApp } from "../extension-sdk/src/index.js";
import { ExtensionHost } from "../src/extension-host.js";

export type Candidate = { id: string; version: string; app: ExtensionApp };

export async function assertExtensionConformance(candidate: Candidate): Promise<void> {
  const host = new ExtensionHost();
  host.register(candidate);
  const entry = host.registry().find(item => item.id === candidate.id);
  assert.ok(entry && entry.state === "active", "Host must publish candidate");
  assert.ok(entry.routes.length > 0, "Candidate requires at least one public route");

  for (const route of entry.routes) {
    assert.equal(host.hasRoute(route.audience, route.method, route.path), true);
    assert.ok(route.publicPaths.length >= 1, "Every published route needs a public mapping");
    assert.equal(host.hasRoute(route.audience === "demo" ? "management" : "demo",
      route.method, route.path), false, "Audience must isolate the route");
  }
  assert.equal(await host.dispatch({ method: "GET", audience: "demo",
    path: "/conformance-no-match" }), null, "Unmatched routes must not be intercepted");
  assert.equal(host.registry().find(item => item.id === candidate.id)?.metrics.count, 0);
}

export function assertPublicationConflicts(): void {
  const host = new ExtensionHost();
  const first = createApp();
  first.get("/conformance/{id}", ctx => { ctx.response.status = 200; });
  first.get("/conformance/ok", ctx => { ctx.response.status = 200; },
    { audience: "management" });
  host.register({ id: "conformance-first", version: "1", app: first });

  const conflicting = createApp();
  conflicting.get("/safe", ctx => { ctx.response.status = 200; });
  conflicting.get("/conformance/fixed", ctx => { ctx.response.status = 200; });
  assert.throws(() => host.register({
    id: "conformance-conflict", version: "1", app: conflicting,
  }), /conflict/i);
  assert.equal(host.hasRoute("demo", "GET", "/safe"), false,
    "An invalid route group must never be partially published");
  assert.equal(host.registry().length, 1);
  const reserved = createApp();
  reserved.get("/api/private", ctx => { ctx.response.status = 200; });
  assert.throws(() => host.register({ id: "reserved", version: "1", app: reserved }),
    /Reserved/);
}

export async function assertMiddlewareContract(): Promise<void> {
  const order: string[] = [];
  const app = createApp();
  app.use(async (ctx, next) => {
    order.push("outer");
    ctx.state.id = ctx.request.correlationId;
    await next();
    order.push("outer-return");
    ctx.response.body = { override: ctx.state.id as string };
    ctx.response.headers["x-conformance"] = "yes";
  });
  app.use("/conformance", async (_ctx, next) => {
    order.push("inner");
    await next();
    order.push("inner-return");
  });
  app.post("/conformance/{item}", ctx => {
    order.push("handler");
    assert.equal(ctx.params.item, "42");
    assert.equal(ctx.query.mode, "test");
    ctx.response.status = 201;
    ctx.response.body = { prior: true };
  });
  const host = new ExtensionHost();
  host.register({ id: "middleware-probe", version: "1", app });
  const result = await host.dispatch({
    method: "POST", audience: "demo", path: "/conformance/42?mode=test",
    correlationId: "conformance-trace",
  });
  assert.deepEqual(result?.response, {
    status: 201, headers: { "x-conformance": "yes" },
    body: { override: "conformance-trace" },
  });
  assert.deepEqual(order, ["outer", "inner", "handler", "inner-return", "outer-return"]);
  const after = host.registry()[0];
  assert.equal(after.metrics.count, 1);
  assert.equal(after.metrics.errors, 0);
}

export async function assertFailureBoundaries(): Promise<void> {
  const host = new ExtensionHost();
  const app = createApp();
  app.get("/bad/header", ctx => {
    ctx.response.status = 200;
    ctx.response.headers["set-cookie"] = "do-not-leak";
  });
  app.get("/bad/payload", ctx => {
    ctx.response.status = 200;
    ctx.response.body = { content: "x".repeat(1024 * 1024 + 1) };
  });
  app.get("/bad/throw", () => { throw Error("secret provider exception"); });
  host.register({ id: "failure-probe", version: "1", app });
  for (const [path, expected] of [
    ["/bad/header", /Unsupported extension response header/],
    ["/bad/payload", /Invalid extension response body/],
    ["/bad/throw", /secret provider exception/],
  ] as const) {
    await assert.rejects(host.dispatch({ method: "GET", audience: "demo", path }), expected);
  }
  assert.equal(host.registry()[0].metrics.errors, 3);
  assert.equal(host.registry()[0].metrics.lastStatus, 502);
  assert.doesNotMatch(JSON.stringify(host.registry()), /do-not-leak|secret provider/);
}

export async function assertTimeoutContract(): Promise<void> {
  const host = new ExtensionHost();
  const app = createApp();
  app.get("/never", async () => await new Promise<void>(() => {}));
  host.register({ id: "timeout-probe", version: "1", app });
  // Host owns a 10s asynchronous deadline; this deliberately tests the actual
  // runtime rather than a mocked timeout or a false promise of sync preemption.
  await assert.rejects(host.dispatch({ method: "GET", audience: "demo", path: "/never" }),
    /Extension request timeout/);
  assert.equal(host.registry()[0].metrics.lastStatus, 504);
  assert.equal(host.registry()[0].metrics.errors, 1);
}
