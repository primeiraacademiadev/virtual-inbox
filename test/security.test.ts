import test from "node:test";
import assert from "node:assert/strict";
import {isAllowedHost,isAllowedOrigin} from "../src/http/security.js";

const hosts=["localhost","127.0.0.1","inbox.internal"];
const origins=new Set(["http://localhost:5173"]);

test("Host policy rejects untrusted rebinding hosts",()=>{
 assert.equal(isAllowedHost("localhost:3000",hosts),true);
 assert.equal(isAllowedHost("inbox.internal:3443",hosts),true);
 assert.equal(isAllowedHost("attacker.example:3000",hosts),false);
 assert.equal(isAllowedHost("localhost@attacker.example",hosts),false);
 assert.equal(isAllowedHost(undefined,hosts),false);
});
test("CORS only permits same-origin or explicit dev origin",()=>{
 assert.equal(isAllowedOrigin("http://localhost:3000","localhost:3000",origins),true);
 assert.equal(isAllowedOrigin("http://localhost:5173","localhost:3000",origins),true);
 assert.equal(isAllowedOrigin("https://evil.example","localhost:3000",origins),false);
 assert.equal(isAllowedOrigin(undefined,"localhost:3000",origins),true);
});

test("demo API preflight accepts the HTTPS console on its own separate port",()=>{
 const applicationOrigins=new Set(["https://127.0.0.1:3443","http://127.0.0.1:3000"]);
 assert.equal(isAllowedOrigin("https://127.0.0.1:3443","127.0.0.1:3444",applicationOrigins),true);
 assert.equal(isAllowedOrigin("https://attacker.example","127.0.0.1:3444",applicationOrigins),false);
});

test("Docker service names and network IPs work without opening public domains",()=>{
 assert.equal(isAllowedHost("virtual-inbox:3000",hosts),true);
 assert.equal(isAllowedHost("172.19.0.5:3000",hosts),true);
 assert.equal(isAllowedHost("[fd00::42]:3000",hosts),true);
 assert.equal(isAllowedHost("attacker.example:3000",hosts),false);
});
