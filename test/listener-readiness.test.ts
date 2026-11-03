import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { startFixedListeners } from "../src/listener-readiness.js";

test("coordinator binds every configured listener and publishes endpoints after listening",async()=>{
 const a=createServer(),b=createServer();
 try{
  const observed:string[]=[];
  const result=await startFixedListeners([
   {name:"HTTP",port:0,host:"127.0.0.1",server:a},
   {name:"SMTP",port:0,host:"127.0.0.1",server:b},
  ],e=>observed.push(e.name));
  assert.deepEqual(observed,["HTTP","SMTP"]);
  assert.equal(result.length,2);
  assert.equal(a.listening,true);
  assert.equal(b.listening,true);
 }finally{
  await Promise.all([a,b].filter(x=>x.listening).map(x=>new Promise<void>(resolve=>x.close(()=>resolve()))));
 }
});
test("bind failure identifies port and closes previously opened listeners",async()=>{
 const occupied=createServer(),started=createServer(),blocked=createServer();
 occupied.listen(0,"127.0.0.1");await once(occupied,"listening");
 const address=occupied.address();
 if(!address||typeof address==="string")throw Error("missing port");
 try{
  await assert.rejects(startFixedListeners([
    {name:"HTTP",port:0,host:"127.0.0.1",server:started},
    {name:"SMTP",port:address.port,host:"127.0.0.1",server:blocked},
  ]),/SMTP port .*EADDRINUSE/);
  assert.equal(started.listening,false);
 }finally{
  await new Promise<void>(resolve=>occupied.close(()=>resolve()));
  if(started.listening)await new Promise<void>(resolve=>started.close(()=>resolve()));
  if(blocked.listening)await new Promise<void>(resolve=>blocked.close(()=>resolve()));
 }
});
test("invalid ports fail before any listener becomes visible",async()=>{
 const server=createServer();
 await assert.rejects(startFixedListeners([{name:"HTTP",port:-1,host:"127.0.0.1",server}]),/Invalid port/);
 assert.equal(server.listening,false);
});
