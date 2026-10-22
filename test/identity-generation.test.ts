import test from "node:test";
import assert from "node:assert/strict";
import {Sandbox} from "../src/core.js";
import {generateAddress,canonicalAddress,generationOptions,locales} from "../src/identity-generation/generator.js";

test("localised name strategies use first/last and surname/first",()=>{
 for(const locale of locales){
  const a=generateAddress("email",{locale,strategy:"FIRST_LAST"});
  const b=generateAddress("email",{locale,strategy:"LAST_FIRST"});
  assert.match(a,/^[a-z0-9]+\.[a-z0-9]+@sandbox\.test$/);
  assert.match(b,/^[a-z0-9]+\.[a-z0-9]+@sandbox\.test$/);
  assert.notEqual(a,"");
 }
});
test("mobile national format ends in 401, supports country-code toggle",()=>{
 const expected={"pt-PT":[/^\+351\d{9}$/,/^\d{9}$/],"en-US":[/^\+1\d{10}$/,/^\d{10}$/],"fr-FR":[/^\+33[67]\d{8}$/,/^0[67]\d{8}$/]};
 for(const locale of locales){
  const international=generateAddress("sms",{locale,includeCountryCode:true});
  const national=generateAddress("sms",{locale,includeCountryCode:false});
  assert.match(international,expected[locale][0]);
  assert.match(national,expected[locale][1]);
  assert.ok(international.endsWith("401"));assert.ok(national.endsWith("401"));
 }
});
test("national and international aliases refer to same inbox",()=>{
 const sandbox=new Sandbox();
 const r=sandbox.create("sms","912345401",120,undefined,{locale:"pt-PT"});
 assert.throws(()=>sandbox.create("sms","+351912345401"),/already exists/);
 assert.equal(sandbox.find("sms","+351912345401")?.id,r.id);
 sandbox.deliver("sms","unit","+351912345401","hello");
 assert.equal(sandbox.listMessages(r.id).length,1);
});
test("manual identifier bypasses generator and defaults remain discoverable",()=>{
 const sandbox=new Sandbox(),r=sandbox.create("email","manual@example.test",60);
 assert.equal(r.address,"manual@example.test");
 assert.equal(generationOptions().defaults.locale,process.env.IDENTITY_DEFAULT_LOCALE||"pt-PT");
});
