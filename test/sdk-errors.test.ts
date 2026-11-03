import test from "node:test";
import assert from "node:assert/strict";
import { VirtualInboxClient, VirtualInboxError, VirtualInboxNoMessageError, type Inbox } from "../sdk/client.js";

const inbox: Inbox = { id:"inbox-1", channel:"email", address:"suite@example.test", createdAt:"2026-11-01T00:00:00Z", expiresAt:null };

test("SDK retains typed structured HTTP error information", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({error:"Invalid inbox",errorCode:"INVALID_INBOX",errorParams:{field:"address"}},{status:400});
  try {
    await assert.rejects(new VirtualInboxClient().create("email","wrong"),
      (error:unknown)=> error instanceof VirtualInboxError && error.status===400 &&
        error.errorCode==="INVALID_INBOX" && error.errorParams.field==="address");
  } finally { globalThis.fetch=old; }
});

test("waitOrThrow distinguishes non-observation and inspects only its inbox", async () => {
  const old=globalThis.fetch;
  const urls:string[]=[];
  globalThis.fetch=async (url)=>{
    urls.push(String(url));
    if(String(url).includes("wait-for-message")) return new Response(null,{status:204});
    return Response.json([{id:"old",sequence:1,from:"sender@example.test",subject:"older",receivedAt:"now"}]);
  };
  try {
    await assert.rejects(new VirtualInboxClient().waitOrThrow(inbox,{subjectContains:"missing"},25,1),
      (error:unknown)=> error instanceof VirtualInboxNoMessageError &&
        error.errorCode==="NO_MESSAGE_OBSERVED" &&
        error.diagnostic.observation==="not_observed_within_window" &&
        error.diagnostic.recent.length===1);
    assert.ok(urls.every(url=>url.includes("/mailboxes/inbox-1/")));
  } finally {globalThis.fetch=old;}
});

test("SDK still rejects administrative writes without HTTPS and token", async()=>{
  const sdk=new VirtualInboxClient();
  await assert.rejects(sdk.createSmtpRule({phase:"MAIL",action:"reply",remaining:1,selectors:{sender:"test@example.test"},code:451}),
    (e:unknown)=>e instanceof VirtualInboxError && e.errorCode==="ADMIN_CONFIGURATION_REQUIRED");
});

test("SDK uses bearer token only on administrative endpoint", async()=>{
  const old=globalThis.fetch;
  const calls:Array<{url:string,authorization:string|null}>=[];
  globalThis.fetch=async(url,init)=>{
    const headers=new Headers(init?.headers);
    calls.push({url:String(url),authorization:headers.get("Authorization")});
    return Response.json([]);
  };
  try {
    const sdk=new VirtualInboxClient("http://127.0.0.1:3000",{adminUrl:"https://localhost:3443",adminToken:"secret"});
    await sdk.findInbox("email","suite@example.test");
    await sdk.smtpSessions();
    await sdk.smtpAttempts({sender:"test@example.test"});
    await sdk.smtpRules();
    assert.ok(calls.slice(0,3).every((call) => call.authorization === null));
    assert.equal(calls[3].authorization,"Bearer secret");
    assert.ok(calls[3].url.startsWith("https://"));
    assert.ok(calls[1].url.startsWith("http://"));
    assert.ok(calls[2].url.startsWith("http://"));
  } finally {globalThis.fetch=old;}
});

test("SDK readiness returns 503 state instead of treating startup as a network error", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ready:false,runId:"run-one",listeners:[]},{status:503});
  try {
    assert.deepEqual(await new VirtualInboxClient().ready(),{
      ready:false,runId:"run-one",listeners:[],
    });
  } finally { globalThis.fetch = old; }
});

test("SDK exact-message operations encode IDs and use the right HTTP methods", async () => {
  const old = globalThis.fetch;
  const calls:Array<{path:string;method:string}> = [];
  globalThis.fetch = async (url,init) => {
    calls.push({path:new URL(String(url)).pathname,method:init?.method??"GET"});
    if (init?.method==="DELETE") return new Response(null,{status:204});
    return Response.json({id:"id/one",sequence:4,channel:"email",destinationId:inbox.id,
      from:"test@example.test",originalRecipient:inbox.address,body:"hello"});
  };
  try {
    const sdk = new VirtualInboxClient();
    assert.equal((await sdk.getMessage(inbox,"id/one")).id,"id/one");
    await sdk.deleteMessage(inbox,"id/one");
    assert.deepEqual(calls,[
      {path:"/mailboxes/inbox-1/messages/id%2Fone",method:"GET"},
      {path:"/mailboxes/inbox-1/messages/id%2Fone",method:"DELETE"},
    ]);
  } finally { globalThis.fetch=old; }
});

test("SDK log replay forwards bounded cursors and returns gap metadata", async()=>{
  const old=globalThis.fetch;
  const calls:string[]=[];
  globalThis.fetch=async url=>{
    calls.push(String(url));
    return Response.json({events:[],gap:true,reset:false,runId:"run-one",
      missingFrom:7,missingTo:10});
  };
  try {
    const sdk=new VirtualInboxClient();
    const replay=await sdk.logs({after:10,limit:100,ruleId:"rule/one",includeAnomalies:false});
    assert.equal(replay.gap,true);
    assert.equal(replay.missingFrom,7);
    const url=new URL(calls[0]);
    assert.equal(url.pathname,"/logs");
    assert.equal(url.searchParams.get("after"),"10");
    assert.equal(url.searchParams.get("limit"),"100");
    assert.equal(url.searchParams.get("ruleId"),"rule/one");
    assert.equal(url.searchParams.get("includeAnomalies"),"false");
    assert.throws(()=>sdk.logs({after:-1}),
      (error:unknown)=>error instanceof VirtualInboxError && error.errorCode==="INVALID_LOG_FILTER");
    assert.equal(calls.length,1,"bad cursor is rejected before making a network request");
  } finally {globalThis.fetch=old;}
});
