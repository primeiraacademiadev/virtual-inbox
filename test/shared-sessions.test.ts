import test from "node:test";
import assert from "node:assert/strict";
import { InboxCredentialStore } from "../src/inbox-credentials.js";
import { SimulationStore } from "../src/simulation-store.js";

test("same inbox and password yield stable GUID", async () => {
 const store = new InboxCredentialStore();
 const id = await store.authenticate("alice@example.test","one");
 assert.equal(await store.authenticate("alice@example.test","one"),id);
 assert.equal(await store.verify("alice@example.test","one",id),true);
 assert.equal(await store.verify("alice@example.test","bad",id),false);
});
test("passwords isolate different sessions in same inbox", async () => {
 const store=new InboxCredentialStore();
 const first=await store.authenticate("inbox@example.test","one");
 const second=await store.authenticate("inbox@example.test","two");
 assert.notEqual(first,second);
 assert.equal(store.resolve(second)?.inbox,"inbox@example.test");
 store.deleteInbox("inbox@example.test");
 assert.equal(store.resolve(first),undefined);
 assert.equal(store.resolve(second),undefined);
});
test("simulation rules trigger only matching protocol and session", () => {
 const rules=new SimulationStore();
 const rule=rules.create({sessionId:"one",protocol:"SMTP",command:"DATA",code:451,message:"Temporary",remaining:1});
 assert.equal(rules.match("other","SMTP","DATA"),undefined);
 assert.equal(rules.match("one","POP3","DATA"),undefined);
 assert.equal(rules.match("one","SMTP","DATA")?.id,rule.id);
 assert.equal(rules.match("one","SMTP","DATA"),undefined);
});
