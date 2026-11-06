/**
 * Bundled SMS demonstration adapter. This module owns the public demo sender
 * contract, not the functional capture operation or the inbox store.
 *
 * All capture requests go through the same public HTTP API and client used by
 * external test applications. Neither the Sandbox nor any private VI internals
 * are available to the handler.
 */
import { createApp, type JsonValue } from "../../extension-sdk/src/index.js";
import { VirtualInboxClient, VirtualInboxError, type SmsIngestion } from "../../sdk/client.js";

export function createNativeSmsExtension(publicApiBaseUrl: string) {
  const app = createApp();
  const client = new VirtualInboxClient(publicApiBaseUrl);

  app.post("/sms/messages", async (ctx) => {
    try {
      // Preserve the legacy input contract: { from, to, body }.
      // Missing/invalid values are validated by the common public API.
      const captured = await client.ingestSms(ctx.request.body as SmsIngestion);
      ctx.response.status = 201;
      ctx.response.body = captured as unknown as JsonValue;
    } catch (error) {
      if (error instanceof VirtualInboxError && error.status >= 400) {
        // The transport adapter must not replace the common API's domain
        // errors (400/413/507, etc.) with a generic extension HTTP 502.
        ctx.response.status = error.status;
        ctx.response.body = {
          error: error.message,
          errorCode: error.errorCode,
          errorParams: error.errorParams,
        };
        return;
      }
      throw error;
    }
  });

  return { id: "sms-native", version: "1.0.0", app };
}
