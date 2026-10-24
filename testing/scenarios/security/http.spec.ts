import {test,expect} from "@playwright/test";
import {baseUrl} from "../../framework/environment";
test("health and Host allowlist",async({request})=>{
 const good=await request.get(baseUrl+"/health");expect(good.ok()).toBeTruthy();
 const bad=await request.get(baseUrl+"/health",{headers:{Host:"attacker.example"}});expect(bad.status()).toBe(421);
});
test("foreign browser Origin is rejected",async({request})=>{
 const response=await request.post(baseUrl+"/api/mailboxes",{headers:{Origin:"https://evil.example","Content-Type":"application/json"},data:{ttlSeconds:120}});
 expect(response.status()).toBe(403);
});
