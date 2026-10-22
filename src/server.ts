import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SMTPServer } from "smtp-server";
import PostalMime from "postal-mime";
import nodemailer from "nodemailer";
import { Sandbox, Fault, classify, type Channel, type Event } from "./core.js";

export const sandbox = new Sandbox(Number(process.env.LOG_CAPACITY || 2000));
const port=Number(process.env.PORT || 3000),smtpPort=Number(process.env.SMTP_PORT || 2525);
function json(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,Last-Event-ID","Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS"});res.end(JSON.stringify(data))}
async function body(req:IncomingMessage){let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>1_100_000)throw new Fault(413,"Payload too large")}try{return raw?JSON.parse(raw):{}}catch{throw new Fault(400,"Invalid JSON")}}
const channels:{[k:string]:Channel}={mailboxes:"email","phone-numbers":"sms"};
function sse(res:ServerResponse,event:string,data:unknown,id?:string){if(res.writableEnded)return;res.write((id?"id: "+id+"\n":"")+"event: "+event+"\n"+"data: "+JSON.stringify(data)+"\n\n")}
function observe(req:IncomingMessage,res:ServerResponse,observerId?:string){
 const o=observerId?sandbox.snapshot(observerId):sandbox.newObserver();
 const url=new URL(req.url||"/","http://localhost");
 const after=String(req.headers["last-event-id"]||url.searchParams.get("after")||"");
 const isRelevant=(e:Event)=>!observerId || (!!e.resourceId && sandbox.observer(observerId).inboxes.has(e.resourceId));
 res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","Access-Control-Allow-Origin":"*","X-Accel-Buffering":"no"});
 const buffered:Event[]=[];
 let replaying=true;
 const emit=(e:Event)=>{sse(res,"log",e,e.id);if(observerId&&e.type.startsWith("message.")&&isRelevant(e))sse(res,"inbox.notification",e)};
 const callback=(e:Event)=>{if(replaying)buffered.push(e);else emit(e)};
 sandbox.emitter.on("event",callback);
 sse(res,observerId?"session.restored":"session.initialized",o);
 const replay=sandbox.replay(after);
 if(!observerId) { /* Global log clients receive all events. */ }
 if(replay.reset)sse(res,"log.reset",{runId:replay.runId});
 if(replay.gap)sse(res,"log.gap",{oldest:replay.oldest,latest:replay.latest});
 for(const e of replay.events)emit(e);
 replaying=false;
 const emitted=new Set(replay.events.map(x=>x.id));
 for(const e of buffered)if(!emitted.has(e.id))callback(e);
 const heartbeat=setInterval(()=>res.write(": heartbeat\n\n"),20000);
 req.on("close",()=>{clearInterval(heartbeat);sandbox.emitter.off("event",callback)});
}
const http=createServer(async(req,res)=>{
 try{
 const path=new URL(req.url||"/","http://localhost").pathname.split("/").filter(Boolean),method=req.method||"GET";
 if(method==="OPTIONS")return json(res,204,{});
 if(path[0]==="health")return json(res,200,{status:"ok",runId:sandbox.runId});
 if(path[0]==="sms"&&path[1]==="messages"&&method==="POST"){const b=await body(req);return json(res,201,sandbox.deliver("sms",b.from,b.to,b.body))}
 if(path[0]==="logs"&&path[1]==="events"&&method==="GET")return observe(req,res);
 if(path[0]==="logs"&&method==="GET"){const u=new URL(req.url||"/","http://localhost");return json(res,200,sandbox.replay(u.searchParams.get("after")||undefined))}
 if(path[0]==="observers"){
  if(path[1]==="events"&&method==="GET")return observe(req,res);
  const oid=path[1];if(!oid)throw new Fault(404,"Unknown observer route");
  if(path[2]==="events"&&method==="GET")return observe(req,res,oid);
  if(path[2]==="inboxes"&&method==="POST"){const b=await body(req);return json(res,200,sandbox.watch(oid,b.inboxId))}
  if(path[2]==="inboxes"&&path[3]&&method==="DELETE"){sandbox.unwatch(oid,path[3]);return json(res,204,{})}
  if(path.length===2&&method==="GET")return json(res,200,sandbox.snapshot(oid));
 }
 if(path[0]==="mailboxes"&&path[1]&&path[2]==="demo-send"&&method==="POST"){
   const recipient=sandbox.resource(path[1]);if(recipient.channel!=="email")throw new Fault(400,"Not an email inbox");
   const b=await body(req);
   const client=nodemailer.createTransport({host:"127.0.0.1",port:smtpPort,secure:false,ignoreTLS:true,disableFileAccess:true,disableUrlAccess:true});
   await client.sendMail({from:b.from||"demo@sandbox.test",to:recipient.address,subject:b.subject||"Demo",text:b.body||""});
   return json(res,202,{accepted:true});
 }
 const channel=channels[path[0]];
 if(channel){
  const id=path[1];
  if(!id){if(method==="GET")return json(res,200,sandbox.list(channel));if(method==="POST"){const b=await body(req);return json(res,201,sandbox.create(channel,channel==="email"?b.address:b.phoneNumber,b.ttlSeconds,b.observerId))}}
  if(id&&path.length===2){if(method==="GET")return json(res,200,sandbox.resource(id));if(method==="DELETE"){sandbox.deleteResource(id);return json(res,204,{})}}
  if(id&&path[2]==="messages"){
    if(path[3]&&method==="GET"){const m=sandbox.listMessages(id).find(m=>m.id===path[3]);if(!m)throw new Fault(404,"Message not found");return json(res,200,m)}
    if(path[3]&&method==="DELETE"){sandbox.removeMessage(id,path[3]);return json(res,204,{})}
    if(method==="GET")return json(res,200,sandbox.listMessages(id));
    if(method==="DELETE"){sandbox.clearMessages(id);return json(res,204,{})}
  }
  if(id&&path[2]==="wait-for-message"&&method==="POST"){
    const b=await body(req),controller=new AbortController();req.on("close",()=>{if(!res.writableEnded)controller.abort()});
    const m=await sandbox.wait(id,b,controller.signal);return json(res,m?200:204,m||{});
  }
 }
 throw new Fault(404,"Route not found");
 }catch(e){const fault=e instanceof Fault?e:new Fault(500,e instanceof Error?e.message:"Server error");if(!res.headersSent)json(res,fault.status,{error:fault.message})}
});
const smtp=new SMTPServer({authOptional:true,disabledCommands:["STARTTLS"],size:1048576,onRcptTo(_address,_session,cb){cb()},onData(stream,session,callback){
 (async()=>{
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of stream){const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=buf.length;if(size>1048576)throw new Fault(413,"MIME too large");chunks.push(buf)}
   const raw=Buffer.concat(chunks);const parsed=await new PostalMime().parse(raw);
   const sender=session.envelope.mailFrom && typeof session.envelope.mailFrom!=="boolean"?session.envelope.mailFrom.address:"unknown@sandbox.test";
   for(const recipient of session.envelope.rcptTo)sandbox.deliver("email",sender,recipient.address,parsed.text||"",parsed.subject,parsed.html||undefined,raw.toString("utf-8"));
   callback(null,"Accepted");
 })().catch(e=>callback(e instanceof Error?e:new Error(String(e))));
}});
const clean=setInterval(()=>sandbox.cleanup(),1000);clean.unref();
http.listen(port,process.env.HOST||"127.0.0.1",()=>console.log("REST listening on "+port));
smtp.listen(smtpPort,process.env.SMTP_HOST||"127.0.0.1",()=>console.log("SMTP listening on "+smtpPort));
process.on("SIGINT",()=>{http.close();smtp.close();process.exit(0)});
