import test from "node:test";
import assert from "node:assert/strict";
import { Sandbox, matchesLog, parseLogFilters } from "../src/core.js";
import { SmtpAttemptStore } from "../src/smtp-attempts.js";
import { SmtpReplyRuleStore } from "../src/smtp-reply-rules.js";

/**
 * Consumer-contract regressions derived from observed integration needs.
 * No Communication checkout, SMTP network, real credentials or arbitrary sleeps.
 */
test("VI-R01: partial RCPT rejection does not consume unrelated recipients or concurrent senders", () => {
  const rules = new SmtpReplyRuleStore();
  const attempts = new SmtpAttemptStore();
  const reject = rules.create({phase:"RCPT",action:"reply",code:451,remaining:1,priority:10,
    selectors:{sender:"suite-a@example.test",recipient:"blocked@example.test"}});
  const a = attempts.begin("connection-a","suite-a@example.test");
  const b = attempts.begin("connection-b","suite-b@example.test");
  const context = {sender:"suite-a@example.test",smtpSessionId:"connection-a"};
  assert.equal(rules.consume("RCPT",{...context,recipients:["allowed@example.test"]}),undefined);
  attempts.update(a.id,{phase:"RCPT",recipient:"allowed@example.test"});
  assert.equal(rules.consume("RCPT",{sender:"suite-b@example.test",smtpSessionId:"connection-b",
    recipients:["blocked@example.test"]}),undefined);
  attempts.update(b.id,{phase:"RCPT",recipient:"blocked@example.test"});
  assert.equal(rules.consume("RCPT",{...context,recipients:["blocked@example.test"]})?.id,reject.id);
  assert.equal(rules.consume("RCPT",{...context,recipients:["blocked@example.test"]}),undefined);
  attempts.update(a.id,{phase:"DATA",messageId:"accepted-a",persisted:true,
    outcome:"stored_and_acknowledged"});
  attempts.update(b.id,{phase:"DATA",messageId:"accepted-b",persisted:true,
    outcome:"stored_and_acknowledged"});
  assert.deepEqual(attempts.list({smtpSessionId:"connection-a"}).map(x=>x.id),[a.id]);
  assert.deepEqual(attempts.list({smtpSessionId:"connection-b"}).map(x=>x.id),[b.id]);
  assert.deepEqual(attempts.list({recipient:"blocked@example.test"}).map(x=>x.id),[b.id]);
  assert.equal(attempts.get(a.id)?.recipients.includes("blocked@example.test"),false);
  assert.equal(rules.list().find(x=>x.id===reject.id)?.remaining,0);
});

test("VI-R02: post-DATA disconnect preserves persisted message and reports ambiguous acknowledgement", () => {
  const rules = new SmtpReplyRuleStore();
  const attempts = new SmtpAttemptStore();
  const postDataRule = rules.create({phase:"AFTER_DATA",action:"drop",remaining:1,
    selectors:{sender:"producer@example.test"}});
  const first = attempts.begin("connection-a","producer@example.test");
  attempts.update(first.id,{phase:"RCPT",recipient:"receiver@example.test"});
  attempts.update(first.id,{phase:"DATA",messageId:"persisted-1",persisted:true});
  assert.equal(rules.consume("AFTER_DATA",{sender:"producer@example.test"})?.id,postDataRule.id);
  attempts.update(first.id,{phase:"AFTER_DATA",ruleId:postDataRule.id});
  attempts.disconnect("connection-a");
  assert.equal(attempts.get(first.id)?.outcome,"stored_without_ack");
  assert.equal(attempts.get(first.id)?.persisted,true);
  assert.deepEqual(attempts.list({ruleId:postDataRule.id})[0].messageIds,["persisted-1"]);
  assert.equal(rules.consume("AFTER_DATA",{sender:"producer@example.test"}),undefined);

  const retry = attempts.begin("connection-b","producer@example.test");
  attempts.update(retry.id,{phase:"RCPT",recipient:"receiver@example.test"});
  attempts.update(retry.id,{phase:"DATA",messageId:"persisted-2",persisted:true,
    outcome:"stored_and_acknowledged"});
  attempts.disconnect("connection-b");
  assert.equal(attempts.get(retry.id)?.outcome,"stored_and_acknowledged");
  assert.deepEqual(attempts.list({sender:"producer@example.test"}).map(x=>x.outcome),
    ["stored_without_ack","stored_and_acknowledged"]);
  assert.notEqual(first.id,retry.id);
  // At-least-once delivery is a consumer decision; VI never silently deduplicates retries.
});

test("VI-R03: global fallback never overrides specific matches, even under interleaving", () => {
  const store = new SmtpReplyRuleStore();
  const global = store.create({phase:"AUTH",action:"reply",code:535,priority:100,remaining:3});
  const forA = store.create({phase:"AUTH",action:"reply",code:454,priority:1,remaining:2,
    selectors:{origin:{ip:"10.1.1.53"},credentialsId:"credentials-a"}});
  const forB = store.create({phase:"AUTH",action:"reply",code:451,priority:5,remaining:1,
    selectors:{credentialsId:"credentials-b"}});
  const order = [
    {originIp:"10.1.1.53",credentialsId:"credentials-a"},
    {originIp:"10.1.1.54",credentialsId:"credentials-b"},
    {originIp:"10.1.1.53",credentialsId:"credentials-a"},
    {originIp:"10.1.1.53",credentialsId:"credentials-a"},
    {originIp:"10.1.1.54",credentialsId:"credentials-b"},
  ];
  assert.deepEqual(order.map(context=>store.consume("AUTH",context)?.id),
    [forA.id,forB.id,forA.id,global.id,global.id]);
  assert.equal(store.list().find(rule=>rule.id===global.id)?.remaining,1);
  assert.equal(store.list().find(rule=>rule.id===forB.id)?.remaining,0);
});

test("VI-R04: replay gap and process reset retain run-scoped ordering and filter out false gaps", () => {
  const box = new Sandbox(3);
  const [one,two,three,four,five] = [
    box.log("smtp.session.connected",undefined,undefined,{smtpSessionId:"s1"}),
    box.log("smtp.simulation.applied",undefined,undefined,{ruleId:"r1",smtpSessionId:"s1"}),
    box.log("smtp.session.connected",undefined,undefined,{smtpSessionId:"s2"}),
    box.log("smtp.simulation.applied",undefined,undefined,{ruleId:"r2",smtpSessionId:"s2"}),
    box.log("smtp.simulation.applied",undefined,undefined,{ruleId:"r3",smtpSessionId:"s3"}),
  ];
  assert.deepEqual([one,two,three,four,five].map(e=>e.log_id),[1,2,3,4,5]);
  const replay = box.replay(one.id,{type:"smtp.simulation.applied",includeAnomalies:false});
  assert.equal(replay.gap,true);
  assert.equal(replay.missingFrom,2);
  assert.equal(replay.missingTo,2);
  assert.deepEqual(replay.events.map(e=>e.id),[four.id,five.id]);
  assert.ok(replay.events.every(e=>e.type==="smtp.simulation.applied"));
  const filtered = box.replay(three.id,{ruleId:"r2",includeAnomalies:false});
  assert.equal(filtered.gap,false,"events filtered out by query are not missing history");
  assert.deepEqual(filtered.events.map(e=>e.id),[four.id]);
  const newRun = new Sandbox(3);
  newRun.log("smtp.session.connected");
  const reset = newRun.replay(five.id);
  assert.equal(reset.reset,true);
  assert.notEqual(newRun.runId,box.runId);
});

test("VI-R05: independent instances share neither in-memory messages nor correlation IDs", () => {
  const left = new Sandbox();
  const right = new Sandbox();
  const address = "isolated@example.test";
  const mine = left.create("email",address,120);
  assert.equal(left.find("email",address)?.id,mine.id);
  assert.equal(right.find("email",address),undefined);
  assert.notEqual(left.runId,right.runId);
  left.log("test.marker",mine.id,undefined,{source:"left"});
  assert.equal(right.events.length,0);
  const expected = parseLogFilters(new URLSearchParams("type=test.marker&inboxId="+mine.id+"&includeAnomalies=false"));
  assert.ok(matchesLog(left.events.at(-1)!,expected));
  assert.equal(right.replay(undefined,expected).events.length,0);
});

test("VI-R06: live log subscriptions, filtered replay and observers preserve event IDs", () => {
  const box = new Sandbox();
  const mine = box.create("email","consumer@example.test",120);
  const observer = box.newObserver();
  const watched = box.watch(observer.observerId,mine.id);
  assert.equal(watched.recipient.id,mine.id);
  const pushed: string[] = [];
  const listener = (event: {id:string}) => pushed.push(event.id);
  box.emitter.on("event",listener);
  const first = box.log("smtp.simulation.applied",mine.id,undefined,
    {ruleId:"rule-a",smtpSessionId:"session-a"});
  const second = box.log("smtp.simulation.applied",mine.id,undefined,
    {ruleId:"rule-b",smtpSessionId:"session-b"});
  box.emitter.off("event",listener);
  assert.deepEqual(pushed,[first.id,second.id],"no missed or reordered live events");
  const afterFirst = box.replay(first.id,{ruleId:"rule-b",includeAnomalies:false});
  assert.equal(afterFirst.reset,false);
  assert.equal(afterFirst.gap,false);
  assert.deepEqual(afterFirst.events.map(event=>event.id),[second.id]);
  assert.equal(box.snapshot(observer.observerId).inboxes[0].id,mine.id);
  const remote = new Sandbox();
  assert.equal(remote.replay(second.id).reset,true,"another instance is a different log run");
});
