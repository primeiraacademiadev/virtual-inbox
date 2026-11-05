import test from "node:test";
import assert from "node:assert/strict";
import { parseSmtpReplyRule, SmtpReplyRuleStore } from "../src/smtp-reply-rules.js";
import { Fault } from "../src/domain-types.js";

const base = { phase: "RCPT", action: "reply", code: 451, remaining: 1 };

function invalid(input: unknown) {
  assert.throws(() => parseSmtpReplyRule(input), error =>
    error instanceof Fault && error.status === 400 && error.code === "INVALID_SMTP_SIMULATION");
}

test("SMTP rule parser rejects malformed input fields and action combinations", () => {
  for (const input of [
    null, [], 5, "rule", { ...base, unknown: "unsupported" },
    { ...base, phase: "NOPE" }, { ...base, phase: null },
    { ...base, action: "not-an-action" }, { ...base, action: 1 },
    { ...base, code: undefined }, { ...base, code: 399 },
    { ...base, code: 600 }, { ...base, code: 450.5 },
    { ...base, remaining: -1 }, { ...base, remaining: 10001 },
    { ...base, remaining: 0.5 }, { ...base, message: 123 },
    { ...base, message: "a".repeat(201) }, { ...base, message: "invalid\nline" },
    { ...base, selectors: [] }, { ...base, selectors: { bad: "x" } },
    { ...base, priority: -10001 }, { ...base, priority: 10001 },
    { ...base, priority: Number.NaN }, { ...base, ttlMs: null },
    { ...base, ttlMs: Number.NaN }, { ...base, durationMs: 1 },
    { ...base, action: "drop", code: 451 },
    { ...base, action: "reset", code: 451 },
    { ...base, action: "hang", durationMs: 1, code: 451 },
    { ...base, action: "hang" }, { ...base, action: "delay", durationMs: 0 },
    { ...base, action: "delay", durationMs: 10001 },
    { ...base, phase: "AUTH", action: "delay", durationMs: 1 },
  ]) invalid(input);
});

test("SMTP selectors reject invalid objects, wildcard, missing phase identity and bad addresses", () => {
  for (const selectors of [
    { origin: {} }, { origin: { ip: "not an ip" } },
    { origin: { ip: "127.0.0.1", port: 25 } },
    { connection: {} }, { connection: { port: -1 } },
    { connection: { port: 65536 } }, { connection: { port: 25, other: true } },
    { sender: "not-an-email" }, { sender: " a@example.test" },
    { recipient: "not-an-email" }, { recipient: 1 },
    { smtpSessionId: "*" }, { clientId: "" }, { credentialsId: " " },
    { ehloName: "x".repeat(321) },
  ]) invalid({ ...base, selectors });
  for (const [phase, selectors] of [
    ["CONNECT", { ehloName: "mail.test" }],
    ["CONNECT", { sender: "a@test.example" }],
    ["EHLO", { recipient: "a@test.example" }],
    ["EHLO", { clientId: "client-1" }],
    ["AUTH", { sender: "a@test.example" }],
    ["AUTH", { clientId: "client-1" }],
    ["MAIL", { recipient: "a@test.example" }],
  ]) invalid({ ...base, phase, selectors });
});

test("SMTP scoped rules match across all supported context dimensions", () => {
  const store = new SmtpReplyRuleStore();
  const rule = store.create({ ...base, remaining: 2, selectors: {
    sender: "SENDER@example.test", recipient: "DEST@example.test",
    clientId: "client-1", smtpSessionId: "session-1",
    origin: { ip: "::ffff:10.0.0.2" }, credentialsId: "credential-1",
    connection: { port: 2525 }, ehloName: "Client.Example.Test",
  } });
  assert.equal(rule.scope, "SPECIFIC");
  assert.equal(rule.selectors.sender, "sender@example.test");
  assert.equal(rule.selectors.recipient, "dest@example.test");
  assert.deepEqual(rule.selectors.origin, { ip: "10.0.0.2" });
  const context = {
    sender: "SENDER@EXAMPLE.TEST", recipients: ["another@example.test", "DEST@EXAMPLE.TEST"],
    clientId: "client-1", smtpSessionId: "session-1", originIp: "10.0.0.2",
    credentialsId: "credential-1", localPort: 2525, ehloName: "CLIENT.EXAMPLE.TEST",
  };
  const mismatches = [
    { sender: "different@example.test" }, { recipients: ["other@example.test"] },
    { clientId: "client-2" }, { smtpSessionId: "session-2" },
    { originIp: "10.0.0.3" }, { credentialsId: "credential-2" },
    { localPort: 2625 }, { ehloName: "different.example.test" },
  ];
  for (const mismatch of mismatches) {
    assert.equal(store.consume("RCPT", { ...context, ...mismatch }), undefined);
    assert.equal(store.list()[0].remaining, 2);
  }
  assert.equal(store.consume("MAIL", context), undefined);
  assert.equal(store.consume("RCPT", context)?.id, rule.id);
  assert.equal(store.consume("RCPT", context)?.remaining, 0);
  assert.equal(store.consume("RCPT", context), undefined);
});

test("SMTP rule capacity, expired and depleted rules, deletion and global fallback", () => {
  let now = Date.parse("2026-11-05T00:00:00.000Z");
  const store = new SmtpReplyRuleStore(2, 50, () => now);
  const specific = store.create({ ...base, ttlMs: 50, selectors: { sender: "x@example.test" } });
  const global = store.create({ ...base, remaining: 3 });
  assert.throws(() => store.create(base), error =>
    error instanceof Fault && error.status === 507);
  assert.equal(store.consume("RCPT", { sender: "x@example.test" })?.id, specific.id);
  assert.equal(store.consume("RCPT", { sender: "x@example.test" })?.id, global.id);
  now += 50;
  assert.deepEqual(store.list().map(rule => rule.id), [global.id]);
  const other = store.create({ ...base, selectors: { sender: "y@example.test" } });
  assert.equal(store.delete(other.id), true);
  assert.equal(store.delete(other.id), false);
  assert.equal(store.consume("RCPT", { sender: "no-match@example.test" })?.id, global.id);
});

test("SMTP delay and hang durations respect injected maximum; rule defaults are stable", () => {
  const rule = parseSmtpReplyRule({ phase: "CONNECT", action: "hang", durationMs: 25, remaining: 1 }, 25);
  assert.equal(rule.durationMs, 25);
  assert.equal(rule.priority, 0);
  assert.equal(rule.scope, "GLOBAL");
  assert.deepEqual(rule.selectors, {});
  assert.equal(rule.message, "Simulated SMTP failure");
  const delayed = parseSmtpReplyRule({
    phase: "DATA", action: "delay", durationMs: 10, code: 451,
    remaining: 1, priority: -5, selectors: { sender: "A@EXAMPLE.TEST" },
  }, 25);
  assert.equal(delayed.action, "delay");
  assert.equal(delayed.selectors.sender, "a@example.test");
  invalid({ phase: "AUTH", action: "reset", remaining: 1 });
});
