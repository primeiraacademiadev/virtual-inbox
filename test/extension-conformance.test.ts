import test from "node:test";
import { createApp } from "../extension-sdk/src/index.js";
import {
  assertExtensionConformance, assertPublicationConflicts,
  assertMiddlewareContract, assertFailureBoundaries, assertTimeoutContract,
} from "./extension-conformance-harness.js";

test("a provider can publish independently of core changes", async () => {
  const app = createApp();
  app.get("/provider/status", ctx => { ctx.response.status = 200; });
  app.post("/provider/messages", ctx => { ctx.response.status = 202; });
  await assertExtensionConformance({ id: "provider-contract", version: "1", app });
});

test("route collisions reject the whole registration snapshot", assertPublicationConflicts);
test("onion middleware, context, response override and correlation", assertMiddlewareContract);
test("invalid response, oversized body and handler failure are bounded", assertFailureBoundaries);
test("asynchronous timeout produces 504 metrics without process termination", { timeout: 15000 }, assertTimeoutContract);
