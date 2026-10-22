# Automate tests with the TypeScript SDK

The client lives in `sdk/client.ts` and uses Node.js 24+ native `fetch`. It is not published as an npm package yet.

## Email assertion example

```ts
import {VirtualInboxClient} from "../sdk/client.js";
const api = new VirtualInboxClient("http://127.0.0.1:3000");
await api.withInbox("email", async inbox => {
  // Configure the application under test to send to inbox.address.
  // Trigger the action in the application that sends SMTP email.
  const message = await api.wait(inbox,{subjectContains:"OTP"},15000);
  if(!message)throw Error("OTP not received");
  if(!message.body.includes("123456"))throw Error("Wrong code");
});
```

`withInbox` always removes the temporary mailbox in `finally`, even when an assertion fails. Waiting never consumes a message.

## SMS assertions

Use `withInbox("sms",...)`, configure the system under test to send SMS through `http://127.0.0.1:3001/sms/messages`, trigger the action, then call `wait`.

## Cursors, timeouts and isolation

`after` refers to a numeric message sequence, not an SSE event ID. `wait` returns a message or `null` when the API responds 204. Prefer random or test-unique recipients to avoid interference. All messages and observer sessions disappear after restart.

## Attachments

JSON responses include attachment metadata. Use `api.download(inbox,message.id,attachment.id)` to retrieve bytes and assert hashes or file content. Check SMTP size limits and quotas during acceptance testing.

[Integration](integration.md) · [API](api.md)
