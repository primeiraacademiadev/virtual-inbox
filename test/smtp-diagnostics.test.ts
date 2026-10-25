import test from "node:test";
import assert from "node:assert/strict";
import { SmtpSessionStore } from "../src/smtp-sessions.js";
import { Sandbox } from "../src/core.js";

test("SMTP sessions accept arbitrary credentials and verify salted history privately", async () => {
  const store = new SmtpSessionStore(5);
  const id = store.connect("127.0.0.1");
  await store.authenticate(id, "client", "secret", "PLAIN");
  const snapshot = store.listSessions()[0];
  assert.equal(snapshot.authenticated, true);
  assert.equal(snapshot.authUser, "client");
  assert.equal(snapshot.authAttempts.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes("secret"));
  assert.ok(!JSON.stringify(snapshot).includes("salt"));
  assert.deepEqual(await store.verifyCredentials(id, "client", "secret"), {
    sessionId: id, attemptId: snapshot.authAttempts[0].id,
    usernameMatches: true, passwordMatches: true, matches: true,
  });
  assert.equal((await store.verifyCredentials(id, "client", "wrong")).matches, false);
  assert.equal((await store.verifyCredentials(id, "wrong", "secret")).usernameMatches, false);
  store.recordMessage(id, "message");
  store.recordError(id, 552, "MESSAGE_TOO_LARGE");
  store.disconnect(id);
  assert.equal(store.listSessions()[0].connected, false);
  assert.equal(store.listSessions()[0].messageIds[0], "message");
  assert.equal(store.listSessions()[0].errors[0].responseCode, 552);
});
test("email HTML, headers, and SMTP metadata can be searched", async () => {
  const store = new Sandbox();
  const inbox = store.create("email", "test@sandbox.test");
  const message = store.deliver("email", "sender@example.test", inbox.address, "", "Notice",
    "<html><body><strong>Verification code</strong></body></html>", undefined, [], {
      headers: { "x-message-id": ["unique-123"], "reply-to": ["support@example.test"] },
      envelope: { mailFrom: "sender@example.test", rcptTo: [inbox.address, "blind@example.test"] },
      sessionId: "session-1",
    });
  assert.equal(message.smtpSessionId, "session-1");
  assert.equal(message.envelope?.rcptTo.length, 2);
  assert.equal((await store.wait(inbox.id, { match: { bodyContains: "Verification code" } }))?.id, message.id);
  assert.equal((await store.wait(inbox.id, { match: { htmlContains: "<strong>Verification" } }))?.id, message.id);
  assert.equal((await store.wait(inbox.id, { match: { header: { name: "X-Message-Id", contains: "unique" } } }))?.id, message.id);
});
