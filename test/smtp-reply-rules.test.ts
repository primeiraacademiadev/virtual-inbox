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
    { phase:"AUTH", action:"drop", remaining:1, selectors:{} },
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
  const precise = store.create({phase:"RCPT", action:"reply", code:451, remaining:1,
    priority:10, selectors:{sender:"sender@example.test", recipient:"one@example.test"}});
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

test("bounded transport actions and post-persistence phases are validated", () => {
  const store = new SmtpReplyRuleStore(10, 250);
  const base = { phase:"DATA", remaining:1, selectors:{sender:"suite@example.test"} };
  const delay = store.create({ ...base, action:"delay", durationMs:50 });
  assert.equal(delay.durationMs,50);
  assert.equal(store.consume("DATA",{sender:"suite@example.test"})?.action,"delay");
  const drop = store.create({ ...base, phase:"AFTER_DATA", action:"drop" });
  assert.equal(store.consume("AFTER_DATA",{sender:"suite@example.test"})?.id,drop.id);
  const hang = store.create({ ...base, phase:"MAIL", action:"hang", durationMs:200 });
  assert.equal(hang.durationMs,200);
  for (const invalid of [
    { ...base, action:"hang", durationMs:251 },
    { ...base, action:"delay", durationMs:0 },
    { ...base, phase:"EHLO", action:"drop" },
    { ...base, action:"drop", code:451 },
    { ...base, action:"reply", durationMs:100, code:451 },
    { ...base, action:"hang", durationMs:100, code:451 },
  ]) assert.throws(() => store.create(invalid), (error:unknown) => error instanceof Fault && error.status===400);
});

test("GLOBAL rules are fallback to SPECIFIC, regardless of numeric priority", () => {
  const store = new SmtpReplyRuleStore();
  const global = store.create({ phase:"AUTH", action:"reply", code:535,
    priority:100, remaining:2 });
  const specific = store.create({ phase:"AUTH", action:"reply", code:454,
    priority:1, remaining:1, selectors:{origin:{ip:"10.1.1.53"}} });
  assert.equal(global.scope,"GLOBAL");
  assert.equal(specific.scope,"SPECIFIC");
  assert.equal(store.consume("AUTH",{originIp:"10.1.1.53"})?.id,specific.id);
  assert.equal(store.consume("AUTH",{originIp:"10.1.1.53"})?.id,global.id);
  assert.equal(store.consume("AUTH",{originIp:"10.1.1.54"})?.id,global.id);
  assert.equal(store.consume("AUTH",{originIp:"10.1.1.54"}),undefined);
});

test("priority and insertion order apply inside one scope; all selectors use AND", () => {
  const store = new SmtpReplyRuleStore();
  const low = store.create({phase:"AUTH",action:"reply",code:454,priority:1,remaining:2,
    selectors:{origin:{ip:"10.1.1.53"}}});
  const first = store.create({phase:"AUTH",action:"reply",code:535,priority:9,remaining:1,
    selectors:{origin:{ip:"10.1.1.53"},credentialsId:"credential-1"}});
  const second = store.create({phase:"AUTH",action:"reply",code:451,priority:9,remaining:1,
    selectors:{origin:{ip:"10.1.1.53"},credentialsId:"credential-1"}});
  assert.equal(store.consume("AUTH",{originIp:"10.1.1.54",credentialsId:"credential-1"}),undefined);
  assert.equal(store.consume("AUTH",{originIp:"10.1.1.53",credentialsId:"credential-2"})?.id,low.id);
  assert.equal(store.consume("AUTH",{originIp:"10.1.1.53",credentialsId:"credential-1"})?.id,first.id);
  assert.equal(store.consume("AUTH",{originIp:"10.1.1.53",credentialsId:"credential-1"})?.id,second.id);
  assert.equal(store.consume("AUTH",{originIp:"10.1.1.53",credentialsId:"credential-1"})?.id,low.id);
});

test("AUTH rejects impossible phase selectors and invalid wildcard/priority", () => {
  const store = new SmtpReplyRuleStore();
  const base = {phase:"AUTH",action:"reply",code:454,remaining:1};
  for (const selectors of [{sender:"from@example.test"},{recipient:"to@example.test"},
    {clientId:"legacy-client"},{origin:{ip:"*"}},{origin:{ip:"10.0.0.1"},sender:"from@example.test"}]) {
    assert.throws(()=>store.create({...base,selectors}),Fault);
  }
  assert.throws(()=>store.create({...base,priority:10001}),Fault);
  assert.throws(()=>store.create({...base,priority:0.5}),Fault);
  assert.equal(store.create({...base,selectors:{}}).scope,"GLOBAL");
  assert.equal(store.create(base).scope,"GLOBAL");
});

test("CONNECT/EHLO use only available selectors, and scope precedence is unchanged", () => {
  const store = new SmtpReplyRuleStore();
  const base = {action:"reply",code:421,remaining:2};
  for (const input of [
    {phase:"CONNECT",selectors:{ehloName:"client.example.test"}},
    {phase:"CONNECT",selectors:{credentialsId:"credentials-1"}},
    {phase:"EHLO",selectors:{credentialsId:"credentials-1"}},
    {phase:"EHLO",selectors:{recipient:"rcpt@example.test"}},
    {phase:"CONNECT",selectors:{connection:{port:0}}},
    {phase:"CONNECT",selectors:{connection:{port:65536}}},
    {phase:"EHLO",selectors:{connection:{port:"2525"}}},
  ]) assert.throws(()=>store.create({...base,...input}),(error:unknown)=>
    error instanceof Fault && error.status===400);
  const global = store.create({...base,phase:"EHLO",priority:99});
  const specific = store.create({...base,phase:"EHLO",priority:1,
    selectors:{origin:{ip:"10.1.1.53"},ehloName:"MiXeD.Example.Test",connection:{port:2525}}});
  assert.equal(specific.selectors.ehloName,"mixed.example.test");
  assert.equal(store.consume("EHLO",{originIp:"10.1.1.53",ehloName:"mixed.example.test",localPort:2526})?.id,global.id);
  assert.equal(store.consume("EHLO",{originIp:"10.1.1.53",ehloName:"MIXED.EXAMPLE.TEST",localPort:2525})?.id,specific.id);
  assert.equal(store.consume("EHLO",{originIp:"10.1.1.53",ehloName:"mixed.example.test",localPort:2525})?.id,specific.id);
  assert.equal(store.consume("EHLO",{originIp:"10.1.1.53",ehloName:"mixed.example.test",localPort:2525})?.id,global.id);
});

test("CONNECT accepts bounded drop, hang and delayed reply rules", () => {
  const store = new SmtpReplyRuleStore(10, 250);
  assert.equal(store.create({phase:"CONNECT",action:"drop",remaining:1,
    selectors:{connection:{port:2525}}}).scope,"SPECIFIC");
  assert.equal(store.create({phase:"CONNECT",action:"hang",durationMs:100,remaining:1}).scope,"GLOBAL");
  assert.equal(store.create({phase:"EHLO",action:"delay",code:451,durationMs:100,
    remaining:1,selectors:{ehloName:"test.example"}}).scope,"SPECIFIC");
  assert.throws(()=>store.create({phase:"CONNECT",action:"hang",remaining:1,durationMs:251}),Fault);
});


test("optional TTL expires unconsumed rules without timer races and frees capacity", () => {
  let now = Date.parse("2026-11-03T00:00:00.000Z");
  const store = new SmtpReplyRuleStore(1, 1000, () => now);
  const input = {phase:"MAIL",action:"reply",code:451,remaining:2,ttlMs:1000};
  for (const ttlMs of [0,-1,1.5,86_400_001]) assert.throws(() =>
    store.create({...input,ttlMs}), Fault);
  const first = store.create(input);
  assert.equal(first.expiresAt,"2026-11-03T00:00:01.000Z");
  now += 999;
  assert.equal(store.consume("MAIL",{})?.id,first.id);
  now += 1;
  assert.equal(store.consume("MAIL",{}),undefined);
  assert.deepEqual(store.list(),[]);
  const replacement = store.create({...input,ttlMs:undefined});
  now += 100_000;
  assert.equal(store.consume("MAIL",{})?.id,replacement.id,
    "rules with no TTL stay eligible while remaining is positive");
});


test("reset is a separate connection-breaking action without SMTP reply code", () => {
  const store = new SmtpReplyRuleStore();
  const rule = store.create({phase:"CONNECT",action:"reset",remaining:1,
    selectors:{connection:{port:2525}}});
  assert.equal(store.consume("CONNECT",{localPort:2525})?.id,rule.id);
  assert.equal(store.consume("CONNECT",{localPort:2525}),undefined);
  assert.throws(() => store.create({phase:"MAIL",action:"reset",code:451,remaining:1}),Fault);
  assert.throws(() => store.create({phase:"MAIL",action:"reset",durationMs:20,remaining:1}),Fault);
});
