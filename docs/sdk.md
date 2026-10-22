# Automated tests — TypeScript SDK

**Audience:** test runners that need to create a recipient, trigger the system under test, wait for a matching message, assert fields and clean up.

The source client lives in [sdk/client.ts](../sdk/client.ts). It has no runtime dependencies and uses native `fetch` on Node.js 24+. It is **not an npm-published package**. Import it in a workspace or copy it into your test project, matching your TypeScript module settings.

```ts
import { VirtualInboxClient } from "../sdk/client.js";

const api = new VirtualInboxClient("http://127.0.0.1:3000");

await api.withInbox("email", async inbox => {
  // Configure your application under test to send to inbox.address.
  // Trigger the action in the system under test that causes SMTP delivery.
  const received = await api.wait(inbox, {subjectContains:"OTP"}, 15000);
  if (!received) throw Error("Expected OTP email was not received");
  if (!received.body.includes("123456")) throw Error("Unexpected message body");
  if (received.attachments?.length) {
    const bytes = await api.download(inbox,received.id,received.attachments[0].id);
    console.log(bytes.length);
  }
});
```

`withInbox` deletes the temporary resource in `finally`, including when assertions fail. The wait endpoint returns **200** when a message is found, **204** on timeout, and does **not consume** messages. Optional `after` is a numeric message sequence; use it to avoid matching a previous test message.

For SMS, call `api.withInbox("sms", ...)`, trigger the application to POST to the mock SMS gateway on **port 3001/3444**, and then call `api.wait`.

### Isolation and limits

Use unique addresses/numbers or let the mock generate them. TTL defaults to 30 minutes and does not substitute for cleanup. The wait timeout is limited by `MAX_WAIT_TIMEOUT_MS`; quotas may return 507. The service is a single-process ephemeral mock, not a durable messaging queue.

### Caution

The sample shows intended client usage, not a published library or a validated end-to-end test. See [development handoff](backlog.md).
