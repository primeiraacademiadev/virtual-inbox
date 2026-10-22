import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync, statSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { TLSSocket } from "node:tls";
import { X509Certificate, createPrivateKey, createPublicKey, timingSafeEqual, randomUUID } from "node:crypto";
import { SMTPServer } from "smtp-server";
import PostalMime from "postal-mime";
import nodemailer from "nodemailer";
import { Sandbox, Fault, classify, type Channel, type Event } from "./core.js";

export const sandbox = new Sandbox(Number(process.env.LOG_CAPACITY || 2000));
const port=Number(process.env.PORT || 3000),smtpPort=Number(process.env.SMTP_PORT || 2525);
const httpsPort=Number(process.env.HTTPS_PORT || 3443),smtpsPort=Number(process.env.SMTPS_PORT || 2465);
const demoPort=Number(process.env.DEMO_PORT || 3001),demoHttpsPort=Number(process.env.DEMO_HTTPS_PORT || 3444);
const tlsCertPath=process.env.TLS_CERT_FILE,tlsKeyPath=process.env.TLS_KEY_FILE;
if(Boolean(tlsCertPath)!==Boolean(tlsKeyPath))throw new Error("TLS_CERT_FILE and TLS_KEY_FILE must be configured together");
const tlsIdentity=tlsCertPath&&tlsKeyPath?{cert:readFileSync(tlsCertPath),key:readFileSync(tlsKeyPath),minVersion:"TLSv1.2" as const}:null;
if(tlsIdentity){
 const cert=new X509Certificate(tlsIdentity.cert);
 const privateKey=createPrivateKey(tlsIdentity.key);
 if(!createPublicKey(privateKey).equals(cert.publicKey))throw new Error("TLS certificate and private key do not match");
}
const addressHost=process.env.PUBLIC_HOST||"localhost";
const apiHost=process.env.HOST||"127.0.0.1";
const smtpHost=process.env.SMTP_HOST||"127.0.0.1";
const smtpMessageLimit=Number(process.env.MAX_SMTP_MESSAGE_BYTES||20*1024*1024);
const frontendRoot=resolve(process.cwd(),"web/dist");
function serveFrontend(req:IncomingMessage,res:ServerResponse,pathParts:string[]) {
  if(!existsSync(join(frontendRoot,"index.html")))return false;
  const candidate=resolve(frontendRoot,"."+sep+pathParts.join(sep));
  const safe=candidate===frontendRoot||candidate.startsWith(frontendRoot+sep);
  if(!safe)return false;
  const file=safe&&existsSync(candidate)&&statSync(candidate).isFile()?candidate:join(frontendRoot,"index.html");
  const extension=extname(file);
  const mime:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon"};
  res.writeHead(200,{"Content-Type":mime[extension]||"application/octet-stream","X-Content-Type-Options":"nosniff"});
  res.end(readFileSync(file));return true;
}

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
async function handleRequest(req:IncomingMessage,res:ServerResponse,demoOnly=false){
 try{
 const rawPath=new URL(req.url||"/","http://localhost").pathname.split("/").filter(Boolean),method=req.method||"GET";
 const path=!demoOnly&&rawPath[0]==="api"?rawPath.slice(1):rawPath;
 if(method==="OPTIONS")return json(res,204,{});
 const demoEndpoint=(path[0]==="mailboxes"&&!!path[1]&&path[2]==="demo-send")||(path[0]==="sms"&&path[1]==="messages");
 if(demoEndpoint!==demoOnly){if(!demoOnly&&method==="GET"&&rawPath[0]!=="api"&&serveFrontend(req,res,rawPath))return;throw new Fault(404,"Route not available on this listener")}
 if(path[0]==="health")return json(res,200,{status:"ok",runId:sandbox.runId});
 if(path[0]==="admin"&&path[1]==="tls"&&method==="PUT"){
   const token=process.env.ADMIN_TOKEN;
   const supplied=String(req.headers.authorization||"").replace(/^Bearer /i,"");
   if(!token||!supplied||Buffer.byteLength(supplied)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))throw new Fault(403,"Administrative authorization required");
   if(!(req.socket instanceof TLSSocket)||!req.socket.encrypted)throw new Fault(403,"Certificate import requires HTTPS");
   if(!tlsCertPath||!tlsKeyPath)throw new Fault(409,"Configure TLS_CERT_FILE and TLS_KEY_FILE on server first");
   const payload=await body(req);
   if(typeof payload.cert!=="string"||typeof payload.key!=="string")throw new Fault(400,"PEM certificate and key required");
   const crt=new X509Certificate(payload.cert),key=createPrivateKey(payload.key);
   if(!createPublicKey(key).equals(crt.publicKey))throw new Fault(400,"Certificate and key do not match");
   const certTemp=tlsCertPath+"."+randomUUID()+".tmp",keyTemp=tlsKeyPath+"."+randomUUID()+".tmp";
   writeFileSync(certTemp,payload.cert,{mode:0o600,flag:"wx"});
   writeFileSync(keyTemp,payload.key,{mode:0o600,flag:"wx"});
   renameSync(certTemp,tlsCertPath);renameSync(keyTemp,tlsKeyPath);
   sandbox.log("tls.identity.uploaded",undefined,undefined,{subject:crt.subject,validTo:crt.validTo});
   return json(res,202,{accepted:true,restartRequired:true,subject:crt.subject,validTo:crt.validTo});
 }

 if(path[0]==="connection-info"&&method==="GET"){
  return json(res,200,{host:addressHost,http:{port,httpsPort:tlsIdentity?httpsPort:null,demoPort,demoHttpsPort:tlsIdentity?demoHttpsPort:null},smtp:{plainPort:smtpPort,starttls:!!tlsIdentity,implicitTlsPort:tlsIdentity?smtpsPort:null,serverName:addressHost},certificate:tlsIdentity?{subject:new X509Certificate(tlsIdentity.cert).subject,issuer:new X509Certificate(tlsIdentity.cert).issuer,validTo:new X509Certificate(tlsIdentity.cert).validTo,fingerprint256:new X509Certificate(tlsIdentity.cert).fingerprint256,download:"/tls/certificate.pem"}:null});
 }
 if(path[0]==="tls"&&path[1]==="certificate.pem"&&method==="GET"){
   if(!tlsIdentity)throw new Fault(404,"TLS is not configured");
   res.writeHead(200,{"Content-Type":"application/x-pem-file","Content-Disposition":"attachment; filename=virtual-inbox-server.pem"});
   return res.end(tlsIdentity.cert);
 }
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
 if(!demoOnly&&method==="GET"&&rawPath[0]!=="api"&&serveFrontend(req,res,rawPath))return;
 throw new Fault(404,"Route not found");
 }catch(e){const fault=e instanceof Fault?e:new Fault(500,e instanceof Error?e.message:"Server error");if(!res.headersSent)json(res,fault.status,{error:fault.message})}
}
const http=createServer((req,res)=>{void handleRequest(req,res)});
const demo=createServer((req,res)=>{void handleRequest(req,res,true)});
const smtpOptions={
 authOptional:true,
 disabledCommands:tlsIdentity?[]:["STARTTLS"],
 size:smtpMessageLimit,
 ...(tlsIdentity?{key:tlsIdentity.key,cert:tlsIdentity.cert,minVersion:"TLSv1.2" as const}:{}),
 onRcptTo(_address:unknown,_session:unknown,cb:(error?:Error|null)=>void){cb()},
 onData(stream:any,session:any,callback:any){
 (async()=>{
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of stream){const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=buf.length;if(size>smtpMessageLimit)throw new Fault(413,"MIME too large");chunks.push(buf)}
   const raw=Buffer.concat(chunks);const parsed=await new PostalMime().parse(raw);
   const sender=session.envelope.mailFrom && typeof session.envelope.mailFrom!=="boolean"?session.envelope.mailFrom.address:"unknown@sandbox.test";
   for(const recipient of session.envelope.rcptTo)sandbox.deliver("email",sender,recipient.address,parsed.text||"",parsed.subject,parsed.html||undefined,raw.toString("utf-8"));
   callback(null,"Accepted");
 })().catch(e=>callback(e instanceof Error?e:new Error(String(e))));
}};
const smtp=new SMTPServer(smtpOptions);
const smtps=tlsIdentity?new SMTPServer({...smtpOptions,secure:true}):null;
const clean=setInterval(()=>sandbox.cleanup(),1000);clean.unref();
http.listen(port,apiHost,()=>console.log("REST listening on "+port));
const https=tlsIdentity?createHttpsServer(tlsIdentity,(req,res)=>{void handleRequest(req,res)}):null;
const demoHttps=tlsIdentity?createHttpsServer(tlsIdentity,(req,res)=>{void handleRequest(req,res,true)}):null;
https?.listen(httpsPort,apiHost,()=>console.log("HTTPS and web console listening on "+httpsPort));
demoHttps?.listen(demoHttpsPort,apiHost,()=>console.log("HTTPS demo API listening on "+demoHttpsPort));
demo.listen(demoPort,apiHost,()=>console.log("Demo API listening on "+demoPort));
smtp.listen(smtpPort,smtpHost,()=>console.log("SMTP listening on "+smtpPort));
smtps?.listen(smtpsPort,smtpHost,()=>console.log("SMTPS listening on "+smtpsPort));
process.on("SIGINT",()=>{http.close();https?.close();demoHttps?.close();demo.close();smtp.close();smtps?.close();process.exit(0)});
