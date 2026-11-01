import test from "node:test";
import assert from "node:assert/strict";
import { SmtpReplyRuleStore } from "../src/smtp-reply-rules.js";
import { Fault } from "../src/domain-types.js";

const create = (store: SmtpReplyRuleStore, phase: "MAIL" | "RCPT" | "DATA", selectors: Record<string,string>, remaining = 1) =>
  store.create({ phase, action: "reply", code: 451, remaining, selectors, message: "Expected failure" });

test("SMTP reply rules validate phase, action, selector availability and reply codes", () => {
  const store = new SmtpReplyRuleStore();
  for (const input of [
    { phase:"CONNECT", action:"reply", code:451, remaining:1, selectors:{sender:"a@b.test"} },
    { phase:"MAIL", action:"drop", code:451, remaining:1, selectors:{sender:"a@b.test"} },
    { phase:"MAIL", action:"reply", code:250, remaining:1, selectors:{sender:"a@b.test"} },
    { phase:"MAIL", action:"reply", code:451, remaining:1, selectors:{recipient:"a@b.test"} },
    { phase:"RCPT", action:"reply", code:451, remaining:1, selectors:{} },
    { phase:"DATA", action:"reply", code:451, remaining:0, selectors:{sender:"a@b.test"} },
    { phase:"DATA", action:"reply", code:451, remaining:1, selectors:{unknown:"a"} },
    { phase:"DATA", action:"reply", code:451, remaining:1, selectors:{sender:"a@b.test"}, message:"bad\r\nheader" },
  ]) assert.throws(() => store.create(input), (error:unknown) => error instanceof Fault && error.status === 400);
  const accepted = create(store, "RCPT", { recipient: "ALICE@EXAMPLE.TEST" });
  assert.equal(accepted.selectors.recipient, "alice@example.test");
});

test("sender, recipient and both selectors are conjunctive and atomically consumed", () => {
  const store = new SmtpReplyRuleStore();
  const generic = create(store, "RCPT", { recipient:"one@example.test" }, 3);
  const precise = create(store, "RCPT", { sender:"sender@example.test", recipient:"one@example.test" });
  const context = {sender:"sender@example.test",recipients:["one@example.test"]};
  assert.equal(store.consume("RCPT", context)?.id, precise.id);
  assert.equal(store.consume("RCPT", context)?.id, generic.id);
  assert.equal(store.consume("RCPT", {sender:"other@example.test",recipients:["one@example.test"]})?.id, generic.id);
  assert.equal(store.consume("RCPT", {sender:"other@example.test",recipients:["two@example.test"]}), undefined);
  assert.equal(store.consume("RCPT", context)?.id, generic.id);
  assert.equal(store.consume("RCPT", context), undefined);
});

test("connection and client selectors isolate simultaneous suites, with stable tie order", () => {
  const store = new SmtpReplyRuleStore();
  const first = create(store, "DATA", {sender:"first@example.test",clientId:"client-1"});
  const second = create(store, "DATA", {sender:"second@example.test",clientId:"client-2"});
  assert.equal(store.consume("DATA", {sender:"first@example.test",clientId:"client-2"}), undefined);
  assert.equal(store.consume("DATA", {sender:"second@example.test",clientId:"client-2"})?.id, second.id);
  assert.equal(store.consume("DATA", {sender:"first@example.test",clientId:"client-1"})?.id, first.id);
  const a = create(store,"MAIL",{sender:"same@example.test"});
  const b = create(store,"MAIL",{sender:"same@example.test"});
  assert.equal(store.consume("MAIL",{sender:"same@example.test"})?.id,a.id);
  assert.equal(store.consume("MAIL",{sender:"same@example.test"})?.id,b.id);
  const id = create(store,"DATA",{smtpSessionId:"smtp-a"},2);
  assert.equal(store.consume("DATA",{smtpSessionId:"smtp-b"}),undefined);
  assert.equal(store.consume("DATA",{smtpSessionId:"smtp-a"})?.id,id.id);
  assert.equal(store.list().find((r)=>r.id===id.id)?.remaining,1);
  assert.equal(store.delete(id.id),true);
  assert.equal(store.delete(id.id),false);
});
