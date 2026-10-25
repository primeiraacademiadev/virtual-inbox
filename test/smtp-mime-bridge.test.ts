import test from "node:test";
import assert from "node:assert/strict";
import PostalMime from "postal-mime";
import { SmtpSessionStore } from "../src/smtp-sessions.js";
import { recordSecuredConnection } from "../src/smtp-session-lifecycle.js";
import { decodedSender } from "../src/mime/decoded-sender.js";

test("TLS upgrade records an existing session, with no duplicates or credential exposure", async () => {
  const store = new SmtpSessionStore();
  const ids = new WeakMap<object, string>();
  const plainTransport = {};
  const secureTransport = {};
  const plainId = store.connect("127.0.0.1", false);
  const secureId = store.connect("127.0.0.1", true);
  ids.set(plainTransport, plainId);
  ids.set(secureTransport, secureId);
  const recorded: string[] = [];
  recordSecuredConnection(plainTransport, ids, store, id => recorded.push(id));
  assert.equal(store.listSessions().find(session => session.id === plainId)?.secure, true);
  assert.deepEqual(recorded, [plainId]);
  recordSecuredConnection(plainTransport, ids, store, id => recorded.push(id));
  assert.equal(store.listSessions().length, 2);
  assert.deepEqual(recorded, [plainId, plainId]);
  recordSecuredConnection(secureTransport, ids, store, id => recorded.push(id));
  assert.equal(store.listSessions().find(session => session.id === secureId)?.secure, true);
  recordSecuredConnection({}, ids, store, () => { throw Error("Unknown session must not log"); });
  assert.equal(store.listSessions().length, 2);
});

test("decoded From exposes RFC 2047 display name while original header stays encoded", async () => {
  const raw = Buffer.from(
    "From: =?UTF-8?Q?Primeira_Academia_=E2=80=94_Testes?= <sender@example.test>\r\n" +
    "To: recipient@sandbox.test\r\nSubject: Test\r\n\r\nHello",
  );
  const parsed = await new PostalMime().parse(raw);
  assert.match(parsed.headers.find(h => h.key === "from")!.value, /=\?UTF-8\?Q\?/);
  assert.deepEqual(decodedSender(parsed.from), {
    name: "Primeira Academia — Testes", address: "sender@example.test",
  });
  assert.equal(decodedSender(undefined), undefined);
  assert.equal(decodedSender(null), undefined);
  assert.equal(decodedSender({ name: "Group" }), undefined);
  assert.deepEqual(decodedSender({ name: "", address: "sender@example.test" }),
    { name: "", address: "sender@example.test" });
});
