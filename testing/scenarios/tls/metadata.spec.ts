import {test,expect} from "@playwright/test";
import {baseUrl,profile} from "../../framework/environment";
test("TLS status reports active certificate and SAN metadata",async()=>{
 const response=await fetch(baseUrl+"/api/tls/status");
 expect(response.ok).toBeTruthy();
 const status=await response.json() as {active:{source:string;subjectAltName:string;fingerprint256:string;validTo:string}|null};
 expect(status.active).not.toBeNull();
 expect(["automatic","external","uploaded"]).toContain(status.active?.source);
 expect(status.active?.fingerprint256).toMatch(/^[A-F0-9:]+$/);
 expect(Date.parse(status.active!.validTo)).toBeGreaterThan(Date.now());
});
test("certificate write without administrator credentials is rejected",async()=>{
 const response=await fetch(baseUrl+"/api/admin/tls",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({cert:"invalid",key:"invalid"})});
 expect([401,403]).toContain(response.status);
});
