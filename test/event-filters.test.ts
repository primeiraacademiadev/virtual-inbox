import test from "node:test";
import assert from "node:assert/strict";
import { Sandbox, Fault } from "../src/core.js";
import { isObserverEventVisible, eventMatchesFilter, parseEventFilter } from "../src/http/event-filters.js";

test("observer never sees global logs or events owned by another inbox",()=>{
 const sandbox=new Sandbox();
 const alice=sandbox.create("email","observer-a@example.test");
 const bob=sandbox.create("email","observer-b@example.test");
 sandbox.deliver("email","send@example.test",alice.address,"hello");
 sandbox.deliver("email","send@example.test",bob.address,"world");
 sandbox.log("smtp.session.error",undefined,undefined,{smtpSessionId:"conn-b"});
 const observer=new Set([alice.id]);
 const allowed=sandbox.events.filter(e=>isObserverEventVisible(e,observer));
 assert.ok(allowed.length>0);
 assert.ok(allowed.every(e=>e.resourceId===alice.id));
 assert.ok(!allowed.some(e=>e.type==="smtp.session.error"));
 assert.ok(!allowed.some(e=>e.resourceId===bob.id));
});

test("REST and SSE filters use identical predicates with AND semantics",()=>{
 const sandbox=new Sandbox();
 sandbox.log("smtp.simulation.applied",undefined,undefined,{smtpSessionId:"a",ruleId:"rule-1"});
 sandbox.log("smtp.simulation.applied",undefined,undefined,{smtpSessionId:"b",ruleId:"rule-1"});
 sandbox.log("smtp.session.error",undefined,undefined,{smtpSessionId:"a"});
 const filter=parseEventFilter(new URLSearchParams("smtpSessionId=a&ruleId=rule-1&eventType=smtp.simulation.applied"));
 assert.equal(sandbox.events.filter(e=>eventMatchesFilter(e,filter)).length,1);
 assert.throws(()=>parseEventFilter(new URLSearchParams("unrecognized=x")),(e:unknown)=>e instanceof Fault&&e.status===400);
});
