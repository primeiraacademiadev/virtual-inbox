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

test("SDK rejects administration without explicit HTTPS and token", async()=>{
  const sdk=new VirtualInboxClient();
  await assert.rejects(sdk.smtpSessions(),(e:unknown)=>e instanceof VirtualInboxError && e.errorCode==="ADMIN_CONFIGURATION_REQUIRED");
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
    assert.equal(calls[0].authorization,null);
    assert.equal(calls[1].authorization,"Bearer secret");
    assert.ok(calls[1].url.startsWith("https://"));
  } finally {globalThis.fetch=old;}
});
