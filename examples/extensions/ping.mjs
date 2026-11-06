// Example trusted embedded extension. Run "npm run build:server" first.
// The bundled SDK is emitted by the TypeScript compilation of the VI server.
// External package import is deferred until the Extension SDK is published.
import { createApp } from "../../dist/extension-sdk/src/index.js";

const app = createApp();
app.use(async (ctx, next) => {
  await next();
  ctx.response.headers["x-vi-example"] = "ping";
});
app.get("/extensions/ping", (ctx) => {
  ctx.response.status = 200;
  ctx.response.body = { ok: true, query: ctx.query.name ?? null };
}, { audience: "management" });
app.get("/ping", (ctx) => {
  ctx.response.status = 200;
  ctx.response.body = { ok: true };
});

export default { id: "example-ping", version: "0.1.0", app };
