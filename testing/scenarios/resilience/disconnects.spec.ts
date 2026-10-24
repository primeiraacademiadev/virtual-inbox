import {test,expect} from "@playwright/test";
import {connect} from "node:net";
import {ApiClient} from "../../framework/api-client";
import {baseUrl,profile,requireManaged} from "../../framework/environment";

test("aborted wait request does not prevent later deliveries",async()=>{
 requireManaged();
 const api=new ApiClient();
 try{
  const inbox=await api.create("email");
  const controller=new AbortController();
  const pending=fetch(baseUrl+"/api/mailboxes/"+inbox.id+"/wait-for-message",{
   method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({timeoutMs:4000,match:{subjectContains:"will-not-arrive"}}),signal:controller.signal
  }).catch(e=>e as Error);
  await new Promise(resolve=>setTimeout(resolve,100));
  controller.abort();
  await pending;
  const health=await fetch(baseUrl+"/health");
  expect(health.status).toBe(200);
  const response=await fetch(baseUrl+"/demo/mailboxes/"+inbox.id+"/demo-send",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({from:"harness@example.test",subject:"after-abort",body:"ok"})});
  expect(response.status).toBe(202);
  await expect.poll(async()=>(await api.messages(inbox)).some(m=>m.subject==="after-abort"),{timeout:3000}).toBe(true);
 }finally{await api.dispose()}
});

test("abrupt SMTP client disconnect does not crash server",async()=>{
 requireManaged();
 await new Promise<void>((resolve,reject)=>{
  const socket=connect({host:profile.host,port:profile.smtp.plainPort},()=>{
   socket.once("data",()=>{socket.write("EHLO broken-client.local\r\n");socket.destroy();resolve()});
  });
  socket.once("error",reject);
 });
 await new Promise(resolve=>setTimeout(resolve,150));
 expect((await fetch(baseUrl+"/health")).status).toBe(200);
 const api=new ApiClient();
 try{
  const inbox=await api.create("email");
  const response=await fetch(baseUrl+"/demo/mailboxes/"+inbox.id+"/demo-send",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subject:"after-smtp-disconnect",body:"ok"})});
  expect(response.status).toBe(202);
 }finally{await api.dispose()}
});
