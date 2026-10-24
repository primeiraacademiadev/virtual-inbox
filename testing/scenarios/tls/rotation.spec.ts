import {test,expect} from "@playwright/test";
import {readFileSync} from "node:fs";
import {request as httpsRequest} from "node:https";
import {connect} from "node:tls";
import {profile,requireManaged} from "../../framework/environment";

const ca=()=>readFileSync(process.env.VI_TEST_CA_FILE!);
async function fingerprint():Promise<string>{
 const port=Number(process.env.VI_HTTPS_PORT||3443);
 return await new Promise((resolve,reject)=>{
  const socket=connect({host:profile.host,port,servername:"localhost",ca:ca(),rejectUnauthorized:true},()=>{
   const certificate=socket.getPeerCertificate();
   const digest=certificate.fingerprint256;
   socket.end();resolve(digest);
  });
  socket.on("error",reject);
 });
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
test("managed TLS SAN rotation replaces the live HTTPS certificate without restart",async()=>{
 requireManaged();
 if(!process.env.ADMIN_TOKEN||!process.env.VI_TEST_CA_FILE)throw Error("Managed identity/CA required");
 const before=await fingerprint();
 const status=await updateSan();
 expect(status.status,status.body).toBe(200);
 const after=await fingerprint();
 expect(after).not.toBe(before);
});
