import test from "node:test";
import assert from "node:assert/strict";
import { resolveNetworkSetting, environmentControlledKeys, shadowedNetworkKeys, assertWritableNetworkSettings } from "../src/network-settings.js";
import { Fault } from "../src/domain-types.js";
test("environment takes precedence over legacy file; legacy still wins over defaults",()=>{
 const env={PORT:"3002",HOST:"0.0.0.0"};
 const saved={PORT:"3000",SMTP_PORT:"2526"};
 assert.equal(resolveNetworkSetting(env,saved,"PORT","8000"),"3002");
 assert.equal(resolveNetworkSetting(env,saved,"SMTP_PORT","2525"),"2526");
 assert.equal(resolveNetworkSetting(env,saved,"HTTPS_PORT","3443"),"3443");
 assert.deepEqual(shadowedNetworkKeys(env,saved),["PORT"]);
 assert.deepEqual(environmentControlledKeys(env,["PORT","SMTP_PORT","HOST"]),["PORT","HOST"]);
});
test("legacy admin updates cannot contradict environment-owned network values",()=>{
 const env={PORT:"3002"};
 assert.throws(()=>assertWritableNetworkSettings({PORT:"3000"},env),(e:unknown)=>
  e instanceof Fault && e.status===409 && e.code==="NETWORK_SETTINGS_ENV_CONTROLLED");
 assert.doesNotThrow(()=>assertWritableNetworkSettings({PORT:"3002",SMTP_PORT:"2525"},env));
});
