import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {ApiClient} from "../../framework/api-client";
import {baseUrl,requireManaged} from "../../framework/environment";

const post=(url:string,payload:unknown)=>fetch(baseUrl+url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
const sms=(to:string,body:string)=>post("/demo/sms/messages",{from:"harness",to,body});

test("concurrent observers independently subscribe and receive messages",async()=>{
 requireManaged();
 const api=new ApiClient();
 const controllers:AbortController[]=[];
 try{
  const inbox=await api.create("sms");
  const observers=await Promise.all(Array.from({length:4},async()=>{
   const controller=new AbortController();controllers.push(controller);
   const response=await fetch(baseUrl+"/api/observers/events",{signal:controller.signal});
   expect(response.status).toBe(200);
   const reader=response.body!.getReader();
   const first=await reader.read();
   const text=new TextDecoder().decode(first.value);
   const match=text.match(/data: (\{[^\n]+\})/);
   expect(match,text).toBeTruthy();
   const session=JSON.parse(match![1]) as {observerId:string};
   return {id:session.observerId,reader};
  }));
  for(const observer of observers){
   const watched=await post("/api/observers/"+observer.id+"/inboxes",{inboxId:inbox.id});
   expect(watched.status).toBe(200);
  }
  const marker="observer-"+randomUUID();
  expect((await sms(inbox.address,marker)).status).toBe(201);
  const received=await api.messages(inbox);
  expect(received.some(m=>m.body===marker)).toBe(true);
  for(const observer of observers){
   const snapshot=await api.json<{inboxes:Array<{id:string}>}>("/observers/"+observer.id);
   expect(snapshot.inboxes.some(i=>i.id===inbox.id)).toBe(true);
  }
  const remove=await fetch(baseUrl+"/api/observers/"+observers[0].id+"/inboxes/"+inbox.id,{method:"DELETE"});
  expect(remove.status).toBe(204);
  expect((await api.json<{inboxes:unknown[]}>("/observers/"+observers[0].id)).inboxes).toHaveLength(0);
  for(const observer of observers.slice(1)){
   expect((await api.json<{inboxes:unknown[]}>("/observers/"+observer.id)).inboxes).toHaveLength(1);
  }
 }finally{controllers.forEach(c=>c.abort());await api.dispose()}
});

test("global message capacity can be recovered by deleting messages",async()=>{
 requireManaged();
 const api=new ApiClient();
 try{
  const inbox=await api.create("sms");
  const prefix="capacity-"+randomUUID();
  for(let i=0;i<80;i++){
   const response=await sms(inbox.address,prefix+"-"+i);
   expect(response.status).toBe(201);
  }
  const rejected=await sms(inbox.address,prefix+"-overflow");
  expect(rejected.status).toBe(507);
  const items=await api.messages(inbox);
  expect(items).toHaveLength(80);
  const deleted=await fetch(baseUrl+"/api/phone-numbers/"+inbox.id+"/messages/"+items[0].id,{method:"DELETE"});
  expect(deleted.status).toBe(204);
  expect((await sms(inbox.address,prefix+"-recovered")).status).toBe(201);
  expect((await fetch(baseUrl+"/health")).status).toBe(200);
 }finally{await api.dispose()}
});

test("SSE replay delivers events missed during disconnection",async()=>{
 requireManaged();
 const api=new ApiClient();
 try{
  const inbox=await api.create("sms");
  const first="replay-first-"+randomUUID(),second="replay-second-"+randomUUID();
  expect((await sms(inbox.address,first)).status).toBe(201);
  const logs=await api.json<{events:Array<{id:string;type:string;resourceId?:string}>}>("/logs");
  const event=logs.events.find(e=>e.type==="message.received"&&e.resourceId===inbox.id);
  expect(event).toBeTruthy();
  expect((await sms(inbox.address,second)).status).toBe(201);
  const ctrl=new AbortController();
  try{
   const response=await fetch(baseUrl+"/api/logs/events?after="+encodeURIComponent(event!.id),{signal:ctrl.signal});
   expect(response.status).toBe(200);
   const reader=response.body!.getReader();
   let stream="";
   for(let i=0;i<5&&!stream.includes("message.received");i++){
    const result=await Promise.race([reader.read(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("SSE replay timeout")),3000))]);
    if(result.done)break;
    stream+=new TextDecoder().decode(result.value);
   }
   expect(stream).toContain("message.received");
  }finally{ctrl.abort()}
 }finally{await api.dispose()}
});
