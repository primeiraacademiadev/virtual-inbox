import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Sandbox, Fault } from "../src/core.js";
import { SmtpSessionStore } from "../src/smtp-sessions.js";
import { SimulationStore } from "../src/simulation-store.js";
import {
  validateConnectionProbeAddress, validateConnectionProbeMessage, deliverConnectionProbe,
} from "../src/connection-probe.js";

const address = () => randomBytes(16).toString("hex") + "@virtual.inbox";

test("connection probe generates discoverable JSON with fixed 60 second TTL", () => {
  const sandbox = new Sandbox();
  const sessions = new SmtpSessionStore();
  const id = sessions.connect("127.0.0.1");
  const to = address();
  validateConnectionProbeMessage([to], undefined, "", undefined, []);
  const messageId = deliverConnectionProbe(sandbox, sessions, to, id);
  const inbox = sandbox.find("email", to)!;
  assert.ok(inbox);
  assert.equal(Date.parse(inbox.expiresAt!) - Date.parse(inbox.createdAt), 60000);
  const message = sandbox.listMessages(inbox.id)[0];
  assert.equal(message.id, messageId);
  assert.equal(message.from, "connection@virtual.inbox");
  assert.deepEqual(JSON.parse(message.body), {
    protocol: "SMTP", smtpSessionId: id, authenticated: false, secure: false,
  });
  const expiresAt = inbox.expiresAt;
  deliverConnectionProbe(sandbox, sessions, to, id);
  assert.equal(sandbox.find("email", to)?.expiresAt, expiresAt);
  assert.equal(sandbox.listMessages(inbox.id).length, 2);
  sandbox.resources.get(inbox.id)!.expiresAt = new Date(Date.now() - 1).toISOString();
  sandbox.cleanup();
  assert.equal(sandbox.resources.has(inbox.id), false);
  assert.equal(sandbox.messages.size, 0);
});

test("probe rejects subject, body, HTML, attachments, multiple recipients and short identifiers", () => {
  const to = address();
  for (const args of [
    [[to], "subject", "", undefined, []],
    [[to], undefined, "text", undefined, []],
    [[to], undefined, "", "<p>HTML</p>", []],
    [[to], undefined, "", undefined, [{}]],
    [[to, "someone@example.test"], undefined, "", undefined, []],
  ] as const) assert.throws(() => validateConnectionProbeMessage(
    args[0] as unknown as string[], args[1], args[2], args[3], args[4],
  ), Fault);
  assert.throws(() => validateConnectionProbeAddress("238764276@virtual.inbox"), Fault);
});

test("SMTP connection-scoped DATA rules apply once to anonymous connections", () => {
  const rules = new SimulationStore();
  const rule = rules.create({
    smtpSessionId: "connection-1", protocol: "SMTP", command: "DATA",
    code: 451, message: "temporary", remaining: 1,
  });
  assert.equal(rules.matchConnection("connection-2", "DATA"), undefined);
  assert.equal(rules.matchConnection("connection-1", "DATA")?.id, rule.id);
  assert.equal(rules.matchConnection("connection-1", "DATA"), undefined);
});
