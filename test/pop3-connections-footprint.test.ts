import test from "node:test";
import assert from "node:assert/strict";
import { Sandbox } from "../src/core.js";
import { SmtpSessionStore } from "../src/smtp-sessions.js";
import { Pop3ConnectionStore } from "../src/pop3-connections.js";
import { InboxCredentialStore } from "../src/inbox-credentials.js";
import { SimulationStore } from "../src/simulation-store.js";
import { applicationFootprint } from "../src/footprint.js";

test("POP3 history is bounded; inactive connections expire and active ones remain", () => {
  const store = new Pop3ConnectionStore(2, 1000);
  const first = store.connect("127.0.0.1");
  store.activity(first);
  store.authenticate(first, " USER@example.test ", "logical-id");
  assert.equal(store.list()[0].inbox, "user@example.test");
  assert.equal(store.list()[0].testSessionId, "logical-id");
  store.disconnect(first);
  assert.equal(store.counts().active, 0);
  const second = store.connect("127.0.0.2");
  const third = store.connect("127.0.0.3");
  assert.equal(store.list().length, 2);
  assert.ok(!store.list().some(row => row.id === first));
  assert.throws(() => store.connect("127.0.0.4"), /capacity/);
  store.disconnect(second);
  store.cleanup(Date.now() + 1200);
  assert.deepEqual(store.list().map(row => row.id), [third]);
});

test("footprint reports actual resources separately from process memory", async () => {
  const sandbox = new Sandbox();
  const inbox = sandbox.create("email", "sample@example.test");
  sandbox.deliver("email", "sender@example.test", inbox.address, "hello footprint");
  const credentials = new InboxCredentialStore();
  credentials.createInbox(inbox.address);
  const guid = await credentials.authenticate(inbox.address, "secret");
  const simulations = new SimulationStore();
  simulations.create({ sessionId: guid, protocol: "POP3", command: "STAT",
    code: 451, message: "temporary", remaining: 1 });
  const pop3 = new Pop3ConnectionStore();
  const id = pop3.connect("127.0.0.1");
  pop3.authenticate(id, inbox.address, guid);
  const snapshot = applicationFootprint(sandbox, new SmtpSessionStore(), pop3,
    credentials, simulations, null);
  assert.ok(snapshot.memory.rss > 0);
  assert.equal(snapshot.resources.emailInboxes, 1);
  assert.equal(snapshot.resources.smsInboxes, 0);
  assert.equal(snapshot.resources.messages, 1);
  assert.ok(snapshot.resources.storedBytes > 0);
  assert.equal(snapshot.resources.logicalSessions, 1);
  assert.equal(snapshot.resources.simulationRules, 1);
  assert.equal(snapshot.protocols.POP3.active, 1);
  assert.equal(snapshot.protocols.SMTP.active, 0);
  assert.equal(snapshot.cleanup.lastAt, null);
});
