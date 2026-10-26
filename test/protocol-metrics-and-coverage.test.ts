import test from "node:test";
import assert from "node:assert/strict";
import { ProtocolCounters } from "../src/protocol-metrics.js";
import { InboxCredentialStore } from "../src/inbox-credentials.js";
import { SimulationStore } from "../src/simulation-store.js";
import { Fault } from "../src/domain-types.js";

test("protocol counters isolate SMTP and POP3, snapshot values, and clamp disconnects", () => {
  const counters = new ProtocolCounters();
  counters.connect("SMTP");
  counters.connect("SMTP");
  counters.connect("POP3");
  counters.auth("SMTP");
  counters.command("SMTP");
  counters.message("SMTP");
  counters.error("SMTP");
  counters.error("SMTP", true);
  counters.auth("POP3");
  counters.command("POP3");
  counters.error("POP3", true);
  counters.disconnect("SMTP");
  counters.disconnect("SMTP");
  counters.disconnect("SMTP");
  counters.disconnect("POP3");
  const result = counters.snapshot();
  assert.deepEqual(result.SMTP, {
    connectionsTotal: 2, connectionsActive: 0, authentications: 1,
    commands: 1, messages: 1, errors: 2, simulatedErrors: 1,
  });
  assert.deepEqual(result.POP3, {
    connectionsTotal: 1, connectionsActive: 0, authentications: 1,
    commands: 1, messages: 0, errors: 1, simulatedErrors: 1,
  });
  result.SMTP.errors = 999;
  assert.equal(counters.snapshot().SMTP.errors, 2, "snapshots must not mutate the store");
});

test("credential store normalizes inboxes, validates credentials, revokes sessions and lists identities", async () => {
  const store = new InboxCredentialStore();
  assert.throws(() => store.createInbox("  "), (error: unknown) => error instanceof Fault);
  await assert.rejects(store.authenticate("alice@example.test", null as unknown as string), (error: unknown) => error instanceof Fault);
  store.createInbox(" ALICE@example.test ");
  const id = await store.authenticate("alice@EXAMPLE.test", "secret");
  assert.equal(await store.authenticate(" ALICE@example.test ", "secret"), id);
  assert.deepEqual(store.resolve(id), { sessionId: id, inbox: "alice@example.test" });
  assert.equal(store.list().length, 1);
  assert.equal(store.list("ALICE@example.test").length, 1);
  assert.equal(store.list("other@example.test").length, 0);
  assert.equal(await store.verify("alice@example.test", null as unknown as string, id), false);
  assert.equal(await store.verify("other@example.test", "secret", id), false);
  assert.equal(await store.verify("alice@example.test", "secret", "unknown"), false);
  assert.equal(await store.verify("alice@example.test", "wrong", id), false);
  store.revoke("unknown");
  store.revoke(id);
  assert.equal(store.resolve(id), undefined);
  assert.equal(store.list().length, 0);
  assert.equal(await store.verify("alice@example.test", "secret", id), false);
  const replacement = await store.authenticate("alice@example.test", "secret");
  assert.notEqual(replacement, id);
  store.deleteInbox("missing@example.test");
  store.deleteInbox(" ALICE@example.test ");
  assert.equal(store.resolve(replacement), undefined);
});

test("simulation store validates inputs, scopes rules, exhausts budgets and deletes rules", () => {
  const store = new SimulationStore();
  const base = { sessionId: "session-a", protocol: "POP3" as const, command: "RETR", code: 451, message: "Simulated", remaining: 2 };
  assert.throws(() => store.create({ ...base, sessionId: "" }));
  assert.throws(() => store.create({ ...base, protocol: "IMAP" as "POP3" }));
  assert.throws(() => store.create({ ...base, command: "retr" }));
  assert.throws(() => store.create({ ...base, code: 399 }));
  assert.throws(() => store.create({ ...base, code: 600 }));
  assert.throws(() => store.create({ ...base, remaining: 0 }));
  const rule = store.create(base);
  assert.equal(store.match(undefined, "POP3", "RETR"), undefined);
  assert.equal(store.match("session-b", "POP3", "RETR"), undefined);
  assert.equal(store.match("session-a", "SMTP", "RETR"), undefined);
  assert.equal(store.match("session-a", "POP3", "STAT"), undefined);
  assert.equal(store.list("session-b").length, 0);
  assert.equal(store.match("session-a", "POP3", "RETR")?.remaining, 1);
  assert.equal(store.match("session-a", "POP3", "RETR")?.remaining, 0);
  assert.equal(store.match("session-a", "POP3", "RETR"), undefined);
  assert.equal(store.list("session-a").length, 1);
  store.delete(rule.id);
  assert.equal(store.list().length, 0);
});
