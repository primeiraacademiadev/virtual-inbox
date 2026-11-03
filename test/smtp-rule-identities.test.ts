import test from "node:test";
import assert from "node:assert/strict";
import { SmtpRuleIdentities } from "../src/smtp-rule-identities.js";
import { Fault } from "../src/domain-types.js";

test("SMTP credentials and origin are resolved idempotently without revealing password or digests", () => {
  const ids = new SmtpRuleIdentities();
  const input = {credentials:{username:"suite@example.test",password:"synthetic-secret"},
    origin:{ip:"::ffff:127.0.0.1"}};
  const first = ids.resolve(input, []);
  const second = ids.resolve(input, []);
  assert.deepEqual(second,first);
  assert.ok("credentials" in first && first.credentials);
  if (!("credentials" in first) || !first.credentials) throw Error("Missing credentials");
  assert.equal(first.credentials.origins.length,1);
  assert.equal(first.credentials.origins[0].ip,"127.0.0.1");
  assert.equal(first.credentials.origins[0].connections.length,0);
  assert.ok(!JSON.stringify(first).includes("synthetic-secret"));
  assert.ok(!JSON.stringify(first).includes("username"));
  assert.notEqual(ids.credentialsId("suite@example.test","synthetic-secret"),
    ids.credentialsId("suite@example.test","other-secret"));
  assert.notEqual(ids.credentialsId("suite@example.test","synthetic-secret"),
    ids.credentialsId("other@example.test","synthetic-secret"));
});

test("SMTP resolve projects independent credential and origin relationships", () => {
  const ids = new SmtpRuleIdentities();
  const c = ids.credentialsId("suite@example.test","synthetic-secret");
  const sessions = [
    {id:"s1",remoteAddress:"127.0.0.1",credentialsIds:[c],connected:true,connectedAt:"2026-01-01T00:00:00Z"},
    {id:"s2",remoteAddress:"10.1.1.53",credentialsIds:[c],connected:false,connectedAt:"2026-01-02T00:00:00Z"},
    {id:"s3",remoteAddress:"127.0.0.1",credentialsIds:["another"],connected:true,connectedAt:"2026-01-03T00:00:00Z"},
  ];
  const withCredentials = ids.resolve({credentials:{username:"suite@example.test",password:"synthetic-secret"}},sessions);
  if (!("credentials" in withCredentials) || !withCredentials.credentials) throw Error("Missing credentials");
  assert.equal(withCredentials.credentials.origins.length,2);
  assert.deepEqual(withCredentials.credentials.origins.flatMap(o=>o.connections.map(c=>c.id)).sort(),["s1","s2"]);
  const withOrigin = ids.resolve({origin:{ip:"127.0.0.1"}},sessions);
  if (!("origins" in withOrigin) || !withOrigin.origins) throw Error("Missing origins");
  assert.deepEqual(withOrigin.origins[0].connections.map(c=>c.id).sort(),["s1","s3"]);
  const both = ids.resolve({credentials:{username:"suite@example.test",password:"synthetic-secret"},
    origin:{ip:"127.0.0.1"}},sessions);
  if (!("credentials" in both) || !both.credentials) throw Error("Missing credentials");
  assert.deepEqual(both.credentials.origins[0].connections.map(c=>c.id),["s1"]);
});

test("SMTP resolve rejects invalid input and never accepts wildcard credentials", () => {
  const ids = new SmtpRuleIdentities();
  for (const input of [{},{origin:{ip:"*"}},{origin:{ip:"not-an-ip"}},
    {credentials:{username:123,password:"synthetic"}},{credentials:{username:"synthetic"}},
    {credentials:{username:"synthetic",password:"synthetic",token:"extra"}},
    {other:"unexpected"}]) {
    assert.throws(()=>ids.resolve(input,[]),(e:unknown)=>e instanceof Fault && e.status===400);
  }
});
