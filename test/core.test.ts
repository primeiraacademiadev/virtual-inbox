import test from "node:test";
import assert from "node:assert/strict";
import { Sandbox, Fault, classify, parseLogFilters } from "../src/core.js";
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

test("inbox TTL never expires early and permits up to 10% scheduling tolerance", () => {
  const s = new Sandbox();
  for (let i = 0; i < 100; i++) {
    const inbox = s.create("email", "ttl-check-" + i + "@example.test", 60);
    const ttlMs = Date.parse(inbox.expiresAt!) - Date.parse(inbox.createdAt);
    assert.ok(ttlMs >= 60000 && ttlMs <= 66000, `TTL must be within [60000, 66000] ms; got ${ttlMs}`);
  }
});

test("log IDs remain sequential and SSE cursors are compatible", () => {
  const s = new Sandbox();
  const first = s.log("test.one");
  const second = s.log("test.two");
  assert.equal(second.log_id, first.log_id! + 1);
  assert.equal(second.id, s.runId + ":" + second.log_id);
  assert.deepEqual(s.replay(first.id).events.map((event) => event.id), [second.id]);
});

test("replay reports precisely the missing range after bounded legacy retention", () => {
  const s = new Sandbox(2);
  const first = s.log("test.one");
  s.log("test.two");
  const third = s.log("test.three");
  const result = s.replay(s.runId + ":0");
  assert.equal(result.gap, true);
  assert.equal(result.missingFrom, 1);
  assert.equal(result.missingTo, 1);
  assert.equal(result.events.at(-1)?.id, third.id);
  assert.equal(s.replay(first.id).gap, false);
});

test("log filters use exact matching, AND, and retain global gap metadata", () => {
  const s = new Sandbox(2);
  const first = s.log("smtp.accepted", "inbox-a", undefined, { sender: "one@test.invalid", recipient: "a@test.invalid" });
  s.log("smtp.rejected", "inbox-b", undefined, { sender: "two@test.invalid" });
  s.log("smtp.accepted", "inbox-a", undefined, { sender: "one@test.invalid", recipients: ["a@test.invalid", "b@test.invalid"] });
  const filtered = s.replay(s.runId + ":0", { type: "smtp.accepted", sender: "one@test.invalid", recipient: "b@test.invalid" });
  assert.equal(filtered.events.length, 1);
  assert.equal(filtered.gap, true);
  assert.equal(filtered.missingFrom, 1);
  assert.equal(first.log_id, 1);
});

test("cursor log pages return newest first without overlap and expose global bounds", () => {
  const s = new Sandbox();
  for (let i = 1; i <= 7; i++) s.log(i % 2 ? "odd" : "even");
  const first = s.pageLogs({ limit: 3 });
  assert.deepEqual(first.events.map((event) => event.log_id), [7, 6, 5]);
  assert.equal(first.hasMore, true);
  assert.equal(first.oldest?.log_id, 1);
  assert.equal(first.latest?.log_id, 7);
  const second = s.pageLogs({ limit: 3, before: first.nextBefore });
  assert.deepEqual(second.events.map((event) => event.log_id), [4, 3, 2]);
  const third = s.pageLogs({ limit: 3, before: second.nextBefore });
  assert.deepEqual(third.events.map((event) => event.log_id), [1]);
  assert.equal(third.hasMore, false);
  const filtered = s.pageLogs({ limit: 2, filters: { type: "even" } });
  assert.deepEqual(filtered.events.map((event) => event.log_id), [6, 4]);
  assert.equal(filtered.latest?.log_id, 7);
  assert.throws(() => s.pageLogs({ limit: 101 }), Fault);
  assert.throws(() => s.pageLogs({ before: 0 }), Fault);
});

test("anomaly events bypass contextual filters unless explicitly disabled", () => {
  const sandbox = new Sandbox();
  sandbox.log("message.received", "inbox-a");
  sandbox.log("message.captured", "anomaly-inbox", undefined, { reason: "UNKNOWN_RECIPIENT" });
  sandbox.log("message.received", "inbox-b");
  const filters = { inboxId: "inbox-a" };
  assert.deepEqual(sandbox.pageLogs({ filters }).events.map(event => event.type),
    ["message.captured", "message.received"]);
  assert.deepEqual(sandbox.replay(undefined, filters).events.map(event => event.type),
    ["message.received", "message.captured"]);
  assert.deepEqual(sandbox.pageLogs({ filters: { ...filters, includeAnomalies: false } }).events.map(event => event.type),
    ["message.received"]);
});
test("anomaly filter parser rejects invalid overrides", () => {
  assert.equal(parseLogFilters(new URLSearchParams("includeAnomalies=false")).includeAnomalies, false);
  assert.equal(parseLogFilters(new URLSearchParams("includeAnomalies=true")).includeAnomalies, true);
  assert.throws(() => parseLogFilters(new URLSearchParams("includeAnomalies=maybe")), Fault);
  assert.throws(() => parseLogFilters(new URLSearchParams("includeAnomalies=true&includeAnomalies=false")), Fault);
});
