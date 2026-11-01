import test from "node:test";
import assert from "node:assert/strict";
import { SmtpAttemptStore } from "../src/smtp-attempts.js";
import { VirtualInboxClient, VirtualInboxError, type Inbox } from "../sdk/client.js";
const inbox:Inbox={id:"case-1",channel:"email",address:"suite@example.test",createdAt:"now",expiresAt:null};

test("SMTP attempts isolate transactions and retain immutable outcome snapshots",()=>{
 const store=new SmtpAttemptStore(3);
 const a=store.begin("conn-1","first@example.test");
 const b=store.begin("conn-1","first@example.test");
 assert.notEqual(a.id,b.id);
 store.update(a.id,{phase:"RCPT",recipient:"one@example.test"});
 store.update(a.id,{phase:"DATA",messageId:"msg-1",persisted:true});
 store.update(a.id,{phase:"AFTER_DATA",ruleId:"rule-1"});
 store.disconnect("conn-1");
 assert.equal(store.get(a.id)?.outcome,"stored_without_ack");
 assert.equal(store.get(b.id)?.outcome,"rejected");
 assert.equal(store.list({messageId:"msg-1"})[0].id,a.id);
 assert.equal(store.list({ruleId:"rule-1"})[0].id,a.id);
 assert.equal(store.list({recipient:"one@example.test"}).length,1);
 assert.equal(store.list({smtpSessionId:"another"}).length,0);
 assert.throws(()=>store.list({}));
 const result=store.list({sender:"first@example.test"});
 result[0].recipients.push("changed");
 assert.equal(store.get(a.id)?.recipients.length,1);
});

test("SDK negative assertion uses a sequence cursor and cannot confuse an observed message with rejection", async()=>{
 const original=globalThis.fetch;
 const requests:string[]=[];
 globalThis.fetch=async (url,init)=>{
  requests.push(String(url));
  if(String(url).includes("wait-for-message")) {
   const body=JSON.parse(String(init?.body));
   assert.equal(body.after,12);
   return Response.json({id:"msg-13",sequence:13});
  }
  return Response.json([]);
 };
 try {
  const sdk=new VirtualInboxClient();
  await assert.rejects(sdk.expectNoMessage(inbox,{after:12,forMs:50}),
   (e:unknown)=>e instanceof VirtualInboxError && e.errorCode==="UNEXPECTED_MESSAGE");
  await sdk.messages(inbox,12);
  assert.ok(requests.at(-1)?.endsWith("/mailboxes/case-1/messages?after=12"));
 } finally {globalThis.fetch=original;}
});

test("SDK negative assertion accepts bounded non-observation without asserting SMTP rejection",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(null,{status:204});
 try {await new VirtualInboxClient().expectNoMessage(inbox,{after:3,forMs:10});}
 finally{globalThis.fetch=original;}
});
