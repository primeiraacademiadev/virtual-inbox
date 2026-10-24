import test from "node:test";
import assert from "node:assert/strict";
import { Sandbox, Fault, classify } from "../src/core.js";
test("classifies identifiers", () => {
  assert.equal(classify("a@example.test"), "email");
  assert.equal(classify("+351900000001"), "sms");
  assert.equal(classify("broken"), null);
});
test("creates, captures, deletes and expires inboxes", () => {
  const s = new Sandbox(3);
  const a = s.create("email", "a@example.test", 60);
  const m = s.deliver("email", "b@example.test", a.address, "Hello", "Subject");
  assert.equal(s.listMessages(a.id)[0].id, m.id);
  s.removeMessage(a.id, m.id);
  assert.equal(s.listMessages(a.id).length, 0);
  const captured = s.deliver("email", "b@example.test", "unknown@example.test", "Hi");
  assert.equal(captured.captureReason, "UNKNOWN_RECIPIENT");
  assert.equal(captured.destinationId, s.defaults.email);
  s.deleteResource(a.id);
  assert.throws(() => s.resource(a.id), Fault);
});
test("observer subscriptions and event replay", () => {
  const s = new Sandbox(3),
    o = s.newObserver(),
    r = s.create("sms", "+351900000001", 300, o.observerId);
  assert.equal(s.snapshot(o.observerId).inboxes[0].id, r.id);
  s.deliver("sms", "demo", "+351900000001", "hello");
  const cursor = s.events[0].id;
  assert.equal(s.replay(cursor).events.length, 1);
});
test("wait matches incoming message without consuming", async () => {
  const s = new Sandbox(),
    r = s.create("email");
  const wait = s.wait(r.id, { timeoutMs: 1000, match: { subjectContains: "OTP" } });
  s.deliver("email", "sender@example.test", r.address, "123456", "OTP");
  const msg = await wait;
  assert.equal(msg?.body, "123456");
  assert.equal(s.listMessages(r.id).length, 1);
});

test("wait finds an HTML-only email by body and by an exact MIME header", async () => {
  const sandbox = new Sandbox();
  const inbox = sandbox.create("email");
  sandbox.deliver(
    "email", "sender@example.test", inbox.address, "", "HTML",
    "<p>One-time <b>code-48192</b></p>", undefined, [],
    {
      headers: [
        { key: "x-message-id", originalKey: "X-Message-ID", value: "trace-unique-42" },
        { key: "x-message-id", originalKey: "X-Message-ID", value: "trace-alternate-84" },
      ],
      envelope: { mailFrom: "sender@example.test", rcptTo: [inbox.address, "hidden@example.test"] },
      authUser: "communication",
    },
  );
  const byBody = await sandbox.wait(inbox.id, {
    timeoutMs: 100, match: { bodyContains: "code-48192" },
  });
  assert.equal(byBody?.body, "");
  assert.match(byBody?.html || "", /code-48192/);
  const byHeader = await sandbox.wait(inbox.id, {
    timeoutMs: 100,
    match: { header: { name: "X-MESSAGE-ID", valueContains: "alternate-84" }, htmlContains: "One-time" },
  });
  assert.equal(byHeader?.id, byBody?.id);
  assert.equal(byHeader?.authUser, "communication");
  assert.deepEqual(byHeader?.envelope?.rcptTo, [inbox.address, "hidden@example.test"]);
});
