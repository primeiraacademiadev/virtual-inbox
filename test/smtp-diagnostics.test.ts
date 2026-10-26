import test from "node:test";
import assert from "node:assert/strict";
import { SmtpSessionStore } from "../src/smtp-sessions.js";
import { InboxCredentialStore } from "../src/inbox-credentials.js";
import { Sandbox, Fault } from "../src/core.js";

test("SMTP accepts credentials only for registered inboxes and verifies salted history privately", async () => {
  const credentials = new InboxCredentialStore();
  credentials.createInbox("client");
  const store = new SmtpSessionStore(5, credentials);
  const id = store.connect("127.0.0.1");
  await assert.rejects(store.authenticate(id, "missing", "secret", "PLAIN"), (error: unknown) =>
    error instanceof Fault && error.code === "TEST_INBOX_NOT_FOUND");
  assert.equal(store.listSessions()[0].authAttempts.length, 0);
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
      headers: [{ key: "x-message-id", originalKey: "X-Message-ID", value: "unique-123" }, { key: "reply-to", originalKey: "Reply-To", value: "support@example.test" }],
      envelope: { mailFrom: "sender@example.test", rcptTo: [inbox.address, "blind@example.test"] },
      authUser: "testing", smtpSessionId: "session-1",
    });
  assert.equal(message.smtpSessionId, "session-1");
  assert.equal(message.envelope?.rcptTo.length, 2);
  assert.equal((await store.wait(inbox.id, { match: { bodyContains: "Verification code" } }))?.id, message.id);
  assert.equal((await store.wait(inbox.id, { match: { htmlContains: "<strong>Verification" } }))?.id, message.id);
  assert.equal((await store.wait(inbox.id, { match: { header: { name: "X-Message-Id", valueContains: "unique" } } }))?.id, message.id);
});

test("SMTP client aggregation distinguishes anonymous and authenticated sessions", async () => {
  const credentials = new InboxCredentialStore();
  credentials.createInbox("integration");
  const store = new SmtpSessionStore(8, credentials);
  const anonymous = store.connect("10.0.0.10", false);
  const first = store.connect("10.0.0.10");
  const second = store.connect("10.0.0.10");
  const remote = store.connect("10.0.0.11");

  const firstLogin = await store.authenticate(first, "integration", "pass-one", "LOGIN");
  const secondLogin = await store.authenticate(second, "integration", "pass-two", "PLAIN");
  await store.authenticate(remote, "integration", "pass-three");
  store.updateTls(first, true);
  store.updateTls(first, false);

  assert.equal(firstLogin.clientId, secondLogin.clientId);
  assert.notEqual(firstLogin.clientId, store.listSessions().find((s) => s.id === remote)?.clientId);
  const clients = store.listClients();
  assert.equal(clients.length, 3);
  const authenticatedClient = clients.find((client) => client.id === firstLogin.clientId)!;
  assert.equal(authenticatedClient.activeSessions, 2);
  assert.equal(authenticatedClient.authenticatedSessions, 2);
  assert.equal(authenticatedClient.totalSessions, 2);
  assert.equal(authenticatedClient.authUser, "integration");
  assert.equal(authenticatedClient.remoteAddress, "10.0.0.10");
  assert.ok(Date.parse(authenticatedClient.firstSeenAt) <= Date.parse(authenticatedClient.lastSeenAt));
  assert.equal(store.listSessions(firstLogin.clientId).length, 2);
  assert.equal(store.listSessions("not-a-client").length, 0);
  assert.equal(store.listSessions().find((s) => s.id === first)?.secure, true);
  assert.equal(clients.find((client) => !client.authUser && client.remoteAddress === "10.0.0.10")?.activeSessions, 1);
  store.disconnect(anonymous);
  store.disconnect(first);
  store.disconnect(first); // Idempotent disconnect.
  const closed = store.listSessions().find((session) => session.id === first)!;
  assert.equal(closed.connected, false);
  assert.ok(closed.disconnectedAt);
  assert.equal(store.listClients().find((client) => client.id === firstLogin.clientId)?.activeSessions, 1);
});

test("SMTP history is bounded; active connections cannot be evicted", () => {
  const store = new SmtpSessionStore(2);
  const first = store.connect("10.0.0.1");
  const second = store.connect("10.0.0.2");
  assert.throws(() => store.connect("10.0.0.3"), (e: unknown) =>
    e instanceof Fault && e.status === 503 && e.code === "SMTP_SESSION_CAPACITY");
  store.disconnect(first);
  const third = store.connect("10.0.0.3");
  assert.equal(store.listSessions().length, 2);
  assert.ok(store.listSessions().some((session) => session.id === third));
  assert.ok(!store.listSessions().some((session) => session.id === first));
  assert.throws(() => store.recordMessage(first, "late-message"), (e: unknown) =>
    e instanceof Fault && e.status === 404);
  assert.throws(() => store.updateTls(first, true), Fault);
  assert.ok(store.listSessions().some((session) => session.id === second));

  store.disconnect(second);
  store.cleanup(Date.now() + 3600001);
  assert.equal(store.listSessions().some((session) => session.id === second), false);
  assert.equal(store.listSessions().some((session) => session.id === third), true);
  assert.equal(store.listClients().length, 1);
});

test("SMTP revalidation selects an exact authentication attempt and rejects invalid requests", async () => {
  const credentials = new InboxCredentialStore();
  credentials.createInbox("first");
  credentials.createInbox("second");
  const store = new SmtpSessionStore(500, credentials);
  const id = store.connect("127.0.0.1");
  await assert.rejects(store.verifyCredentials(id, "someone", "secret"), (e: unknown) =>
    e instanceof Fault && e.status === 404 && e.code === "SMTP_AUTH_NOT_FOUND");
  await assert.rejects(store.authenticate(id, null as unknown as string, "secret"), (e: unknown) =>
    e instanceof Fault && e.code === "INVALID_SMTP_CREDENTIALS");
  await store.authenticate(id, "first", "old-password", "PLAIN");
  const firstAttempt = store.listSessions()[0].authAttempts[0].id;
  await store.authenticate(id, "second", "new-password", "LOGIN");
  const latestAttempt = store.listSessions()[0].authAttempts[1].id;
  assert.notEqual(firstAttempt, latestAttempt);
  assert.equal((await store.verifyCredentials(id, "first", "old-password", firstAttempt)).matches, true);
  assert.equal((await store.verifyCredentials(id, "second", "new-password")).matches, true);
  assert.equal((await store.verifyCredentials(id, "first", "old-password")).matches, false);
  assert.equal((await store.verifyCredentials(id, "second", "old-password", latestAttempt)).passwordMatches, false);
  await assert.rejects(store.verifyCredentials(id, "first", "old-password", "unknown"), (e: unknown) =>
    e instanceof Fault && e.code === "SMTP_AUTH_NOT_FOUND");
  await assert.rejects(store.verifyCredentials(id, undefined as unknown as string, "secret"), (e: unknown) =>
    e instanceof Fault && e.code === "INVALID_REQUEST");
  await assert.rejects(store.verifyCredentials("unknown", "first", "old-password"), Fault);
});

test("SMTP authentication, message and error histories retain only bounded records", async () => {
  const credentials = new InboxCredentialStore();
  for (let n = 0; n < 11; n++) credentials.createInbox("username-" + n);
  const store = new SmtpSessionStore(500, credentials);
  const id = store.connect("127.0.0.1");
  let oldestAttemptId = "";
  for (let n = 0; n < 11; n++) {
    await store.authenticate(id, "username-" + n, "password-" + n, "PLAIN");
    if (n === 0) oldestAttemptId = store.listSessions()[0].authAttempts[0].id;
  }
  for (let n = 0; n < 101; n++) store.recordMessage(id, "message-" + n);
  for (let n = 0; n < 21; n++) store.recordError(id, 450 + n, "TEST_" + n);
  const session = store.listSessions()[0];
  assert.equal(session.authAttempts.length, 10);
  assert.equal(session.messageIds.length, 100);
  assert.equal(session.errors.length, 20);
  assert.equal(session.messageIds[0], "message-1");
  assert.equal(session.errors[0].code, "TEST_1");
  assert.equal(session.authAttempts[0].authUser, "username-1");
  assert.equal((await store.verifyCredentials(id, "username-10", "password-10")).matches, true);
  // An omitted attempt ID checks the latest attempt; removed IDs are not retrievable.
  assert.equal((await store.verifyCredentials(id, "username-0", "password-0")).matches, false);
  await assert.rejects(store.verifyCredentials(id, "username-0", "password-0", oldestAttemptId), (e: unknown) =>
    e instanceof Fault && e.code === "SMTP_AUTH_NOT_FOUND");
  assert.ok(!JSON.stringify(store.listSessions()).includes("password-10"));
  assert.ok(!JSON.stringify(store.listClients()).includes("password-10"));
});
