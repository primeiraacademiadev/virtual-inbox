// Independent mock provider: only the published Extension SDK and the functional
// Virtual Inbox client are imported. No private Sandbox or Host APIs.
import { createApp } from "../../dist/extension-sdk/src/index.js";
import { VirtualInboxClient } from "../../dist/sdk/client.js";

const publicApi = process.env.VI_EXAMPLE_PUBLIC_API_URL;
if (!publicApi) throw new Error("VI_EXAMPLE_PUBLIC_API_URL must target the VI public API listener");
const client = new VirtualInboxClient(publicApi);
const app = createApp();

app.use("/provider", async (ctx, next) => {
  const token = ctx.request.headers.authorization;
  if (token !== "Bearer synthetic-provider-key") {
    ctx.response.status = 401;
    ctx.response.body = { accepted: false, error: "INVALID_PROVIDER_TOKEN" };
    return;
  }
  await next();
  ctx.response.headers["x-provider-adapter"] = "example";
});

app.get("/provider/status", ctx => {
  ctx.response.status = 200;
  ctx.response.body = { provider: "synthetic", ready: true };
});

app.post("/provider/messages", async ctx => {
  const input = ctx.request.body;
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.sender !== "string" || typeof input.recipient !== "string" ||
      typeof input.text !== "string") {
    ctx.response.status = 400;
    ctx.response.body = { accepted: false, error: "INVALID_PROVIDER_REQUEST" };
    return;
  }
  const captured = await client.ingestSms({
    from: input.sender,
    to: input.recipient,
    body: input.text,
  });
  ctx.response.status = 202;
  ctx.response.body = { accepted: true, reference: captured.id };
});

export default {
  id: "example-provider",
  version: "1.0.0",
  displayName: "Synthetic SMS provider",
  capabilities: ["sms-sender", "test-provider"],
  documentation: "/wiki/en/extensions.md",
  app,
};
