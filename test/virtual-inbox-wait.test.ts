import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Sandbox, Fault } from "../src/core.js";
import { SmtpSessionStore } from "../src/smtp-sessions.js";
import { deliverConnectionProbe, waitForConnectionProbeMessage } from "../src/connection-probe.js";

const addr = () => randomBytes(16).toString("hex") + "@virtual.inbox";

test("reserved virtual.inbox cannot be provisioned through ordinary creation", () => {
  const sandbox = new Sandbox();
  const to = addr();
  assert.throws(() => sandbox.create("email", to, 60),
    (error: unknown) => error instanceof Fault && error.code === "RESERVED_INBOX_DOMAIN");
  assert.throws(() => sandbox.create("email", "invalid@virtual.inbox", 60), Fault);
  assert.throws(() => sandbox.createConnectionProbe("invalid@virtual.inbox"), Fault);
  assert.equal(sandbox.find("email", to), undefined);
  const created = sandbox.createConnectionProbe(to);
  assert.equal(Date.parse(created.expiresAt!) - Date.parse(created.createdAt), 60000);
});

test("waiting before SMTP delivery does not create an inbox", async () => {
  const sandbox = new Sandbox();
  const sessions = new SmtpSessionStore();
  const smtpSessionId = sessions.connect("127.0.0.1");
  const to = addr();
  const waiting = waitForConnectionProbeMessage(sandbox, to, { timeoutMs: 1000 });
  assert.equal(sandbox.find("email", to), undefined);
  deliverConnectionProbe(sandbox, sessions, to, smtpSessionId);
  const response = await waiting;
  assert.equal(JSON.parse(response!.body).smtpSessionId, smtpSessionId);
  assert.equal((await waitForConnectionProbeMessage(sandbox, to, {}))?.id, response?.id);
});

test("probe wait is restricted, bounded and cancellable", async () => {
  const sandbox = new Sandbox();
  assert.throws(() => waitForConnectionProbeMessage(sandbox, "other@example.test", {}), Fault);
  assert.throws(() => waitForConnectionProbeMessage(sandbox, addr(), { timeoutMs: 60001 }), Fault);
  const to = addr();
  assert.equal(await waitForConnectionProbeMessage(sandbox, to, { timeoutMs: 15 }), null);
  assert.equal(sandbox.find("email", to), undefined);
  const abort = new AbortController();
  const waiting = waitForConnectionProbeMessage(sandbox, addr(), { timeoutMs: 1000 }, abort.signal);
  abort.abort();
  assert.equal(await waiting, null);
});

test("waiting for a later reply cannot outlive an existing probe inbox", async () => {
  const sandbox = new Sandbox();
  const sessions = new SmtpSessionStore();
  const to = addr();
  deliverConnectionProbe(sandbox, sessions, to, sessions.connect("127.0.0.1"));
  const inbox = sandbox.find("email", to)!;
  const sequence = sandbox.listMessages(inbox.id)[0].sequence;
  inbox.expiresAt = new Date(Date.now() + 25).toISOString();
  const result = await waitForConnectionProbeMessage(sandbox, to,
    { after: sequence, timeoutMs: 1000 });
  assert.equal(result, null);
});
