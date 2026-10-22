# Test automation with the SDK

The SDK has no runtime dependencies and uses the native `fetch` in Node.js 24+. Import `VirtualInboxClient` from `sdk/client.ts` in a workspace or copy the client into a TypeScript project.

```ts
import { VirtualInboxClient } from "../sdk/client.js";
const api = new VirtualInboxClient("http://127.0.0.1:3000");
await api.withInbox("email", async inbox => {
  // Configure your application-under-test to send SMTP to localhost:2525.
  // Use inbox.address as recipient and trigger an email.
  const message = await api.wait(inbox, {subjectContains:"OTP"}, 15000);
  if (!message) throw Error("OTP email did not arrive");
  if (message.attachments?.length) {
    const bytes = await api.download(inbox,message.id,message.attachments[0].id);
    console.log("Received attachment bytes:",bytes.byteLength);
  }
});
```

The cleanup runs in `finally` even when the assertion fails. Waits never consume messages. The SDK intentionally does **not** send SMS or SMTP: those operations belong to the application under test or the separate demo listener.
