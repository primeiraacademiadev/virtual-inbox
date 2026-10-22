# Automate tests

Create disposable inboxes, trigger the application under test and wait for assertions.

## TypeScript client

The SDK lives at `sdk/client.ts` and uses native fetch. Create a `VirtualInboxClient`; call `withInbox("email", async inbox => { ... })` and `api.wait(inbox, {subjectContains:"OTP"}, 15000)`. Cleanup runs in `finally`.

## Assertions

The wait API returns HTTP 200 with a message or HTTP 204 on timeout. The `after` cursor is a numeric message sequence, not an SSE event ID.

---

[Management API](api.md) · [TLS](tls.md) · [SDK](sdk.md)
