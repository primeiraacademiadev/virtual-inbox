import {test,expect} from "@playwright/test";
import {readFileSync} from "node:fs";
import {request as httpsRequest} from "node:https";
import {connect as tlsConnect, type TLSSocket} from "node:tls";
import {connect as tcpConnect, type Socket} from "node:net";
import {randomUUID} from "node:crypto";
import {ApiClient} from "../../framework/api-client";
import {SmtpDriver} from "../../drivers/smtp-driver";
import {profile,requireManaged} from "../../framework/environment";

const ca=()=>readFileSync(process.env.VI_TEST_CA_FILE!);
async function fingerprint():Promise<string>{
 const port=Number(process.env.VI_HTTPS_PORT||3443);
 return await new Promise((resolve,reject)=>{
  const socket=tlsConnect({host:profile.host,port,servername:"localhost",ca:ca(),rejectUnauthorized:true},()=>{
   const certificate=socket.getPeerCertificate();
   const digest=certificate.fingerprint256;
   socket.end();resolve(digest);
  });
  socket.on("error",reject);
 });
}

async function smtpsFingerprint():Promise<string>{
 return new Promise((resolve,reject)=>{
  const socket=tlsConnect({host:profile.host,port:profile.smtp.smtpsPort,servername:"localhost",ca:ca(),rejectUnauthorized:true});
  socket.setTimeout(7000,()=>socket.destroy(new Error("SMTPS connection timeout")));
  socket.once("secureConnect",()=>{
   const fp=socket.getPeerCertificate().fingerprint256;
   socket.destroy();resolve(fp);
  });
  socket.once("error",reject);
 });
}
function smtpReply(socket:Socket|TLSSocket,expected:number,timeoutMs=7000):Promise<string>{
 return new Promise((resolve,reject)=>{
  let buffer="",lines:string[]=[];
  const timeout=setTimeout(()=>done(new Error("SMTP timeout waiting for "+expected)),timeoutMs);
  function done(error?:Error,value?:string){
   clearTimeout(timeout);socket.off("data",onData);socket.off("error",onError);
   error?reject(error):resolve(value||"");
  }
  function onError(error:Error){done(error)}
  function onData(chunk:Buffer){
   buffer+=chunk.toString("utf8");
   let index;
   while((index=buffer.indexOf("\r\n"))!==-1){
    const line=buffer.slice(0,index);buffer=buffer.slice(index+2);lines.push(line);
    if(/^\d{3} /.test(line)){
     const code=Number(line.slice(0,3));
     return code===expected?done(undefined,lines.join("\n")):done(new Error("Unexpected SMTP reply: "+lines.join("\n")));
    }
   }
  }
  socket.on("data",onData);socket.once("error",onError);
 });
}
async function starttlsFingerprint():Promise<string>{
 const socket=tcpConnect({host:profile.host,port:profile.smtp.plainPort});
 socket.setNoDelay(true);
 try{
  const greeting=smtpReply(socket,220);
  await new Promise<void>((resolve,reject)=>{socket.once("connect",resolve);socket.once("error",reject)});
  await greeting;
  const hello=smtpReply(socket,250);socket.write("EHLO test-harness.local\r\n");await hello;
  const upgrade=smtpReply(socket,220);socket.write("STARTTLS\r\n");await upgrade;
  const secured=tlsConnect({socket,servername:"localhost",ca:ca(),rejectUnauthorized:true});
  secured.setTimeout(7000,()=>secured.destroy(new Error("STARTTLS handshake timeout")));
  return await new Promise<string>((resolve,reject)=>{
   secured.once("secureConnect",()=>{const fp=secured.getPeerCertificate().fingerprint256;secured.destroy();resolve(fp)});
   secured.once("error",reject);
  });
 }finally{socket.destroy()}
}

async function updateSan(){
 const content=JSON.stringify({dns:["localhost","rotation.example.test"],ips:["127.0.0.1"]});
 const port=Number(process.env.VI_HTTPS_PORT||3443);
 return await new Promise<{status:number;body:string}>((resolve,reject)=>{
  const req=httpsRequest({hostname:profile.host,port,path:"/api/admin/tls/names",method:"PUT",servername:"localhost",ca:ca(),rejectUnauthorized:true,headers:{"authorization":"Bearer "+process.env.ADMIN_TOKEN,"content-type":"application/json","content-length":Buffer.byteLength(content)}},res=>{
   const chunks:Buffer[]=[];res.on("data",(chunk:Buffer)=>chunks.push(chunk));res.on("end",()=>resolve({status:res.statusCode||0,body:Buffer.concat(chunks).toString("utf8")}));
  });
  req.on("error",reject);req.end(content);
 });
}
test("managed SAN rotation updates HTTPS, SMTPS and STARTTLS without restart",async()=>{
 requireManaged();
 if(!process.env.ADMIN_TOKEN||!process.env.VI_TEST_CA_FILE)throw Error("Managed identity/CA required");
 const before=await Promise.all([fingerprint(),smtpsFingerprint(),starttlsFingerprint()]);
 expect(new Set(before).size,"Initial listeners must share a certificate").toBe(1);
 const response=await updateSan();
 expect(response.status,response.body).toBe(200);
 const after=await Promise.all([fingerprint(),smtpsFingerprint(),starttlsFingerprint()]);
 expect(new Set(after).size,"All listeners must expose the same rotated certificate").toBe(1);
 expect(after[0]).not.toBe(before[0]);

 const api=new ApiClient(),smtp=new SmtpDriver();
 try{
  const inbox=await api.create("email");
  for(const mode of ["starttls","smtps"] as const){
   const subject="After-rotation-"+mode+"-"+randomUUID();
   const receipt=await smtp.send(mode,{to:inbox.address,subject,text:"TLS rotation verified"});
   expect(receipt.accepted).toContain(inbox.address);
   const messages=await api.messages(inbox);
   expect(messages.some(message=>message.subject===subject)).toBe(true);
  }
 }finally{await api.dispose()}
});
