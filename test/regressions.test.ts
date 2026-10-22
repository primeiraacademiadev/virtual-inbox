import test from "node:test";
import assert from "node:assert/strict";
import {Sandbox} from "../src/core.js";
import {config} from "../src/config.js";

test("observer renewal honors configured TTL",()=>{
 const sandbox=new Sandbox();const o=sandbox.newObserver();
 const value=sandbox.observers.get(o.observerId)!;
 value.expiresAt=Date.now()+1;
 sandbox.observer(o.observerId);
 const diff=value.expiresAt-Date.now();
 assert.ok(diff>config.observerTtl*1000-1000&&diff<=config.observerTtl*1000);
});
test("expired observer does not affect delivery and retained subscription can be inspected without renewal",()=>{
 const sandbox=new Sandbox();const observer=sandbox.newObserver();
 const inbox=sandbox.create("email","observer.test@sandbox.test",60,observer.observerId);
 sandbox.observers.get(observer.observerId)!.expiresAt=Date.now()-1;
 sandbox.cleanup();
 assert.equal(sandbox.observers.has(observer.observerId),false);
 assert.doesNotThrow(()=>sandbox.deliver("email","source@example.test",inbox.address,"hello"));
 assert.equal(sandbox.listMessages(inbox.id).length,1);
});
test("attachment quotas are evaluated using actual byte length",()=>{
 const sandbox=new Sandbox();const r=sandbox.create("email","attachment.test@sandbox.test");
 const data=Buffer.from("sample");
 sandbox.deliver("email","sender@sandbox.test",r.address,"body","subject",undefined,undefined,[{id:"a",filename:"report.pdf",contentType:"application/pdf",size:data.byteLength,content:data}]);
 const a=sandbox.listMessages(r.id)[0].attachments![0];
 assert.equal(a.filename,"report.pdf");assert.equal(a.size,6);assert.deepEqual(a.content,data);
});
