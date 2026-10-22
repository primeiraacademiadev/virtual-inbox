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
