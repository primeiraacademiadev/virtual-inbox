import test from "node:test";
import assert from "node:assert/strict";
import { Sandbox, Fault } from "../src/core.js";
import { createOpenApiDocument } from "../src/http/api-contract.js";

test("explicit inbox reuse returns identical inbox without renewing TTL", () => {
 const sandbox=new Sandbox();
 const first=sandbox.create("email","alice@example.test",30);
 const again=sandbox.create("email","ALICE@EXAMPLE.TEST",600,undefined,undefined,"return");
 assert.equal(again.id,first.id);
 assert.equal(again.expiresAt,first.expiresAt);
 assert.equal(sandbox.list("email").filter(x=>!x.system).length,1);
 assert.throws(()=>sandbox.create("email","alice@example.test",30),
  (error:unknown)=>error instanceof Fault && error.code==="CONFLICT");
});

test("expired addresses can be reused safely, and reserved or system inboxes cannot",()=>{
 const sandbox=new Sandbox();
 const first=sandbox.create("email","expiring@example.test",1);
 sandbox.resources.get(first.id)!.expiresAt=new Date(Date.now()-1).toISOString();
 const renewed=sandbox.create("email","expiring@example.test",30,undefined,undefined,"return");
 assert.notEqual(first.id,renewed.id);
 assert.equal(sandbox.find("email",renewed.address)?.id,renewed.id);
 assert.throws(()=>sandbox.create("email","anomalies@sandbox.test",30,undefined,undefined,"return"),Fault);
 assert.throws(()=>sandbox.create("email","f".repeat(32)+"@virtual.inbox",30,undefined,undefined,"return"),
  (e:unknown)=>e instanceof Fault && e.code==="RESERVED_INBOX_DOMAIN");
 assert.throws(()=>sandbox.create("email",undefined,30,undefined,undefined,"return"),Fault);
});

test("OpenAPI advertises explicit idempotency and capability discovery",()=>{
 const doc=createOpenApiDocument() as any;
 assert.ok(doc.paths["/capabilities"]?.get);
 const schema=doc.components.schemas.CreateMailbox;
 assert.deepEqual(schema.properties.ifExists.enum,["error","return"]);
});
