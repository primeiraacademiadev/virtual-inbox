import forge from "node-forge";
import {existsSync,mkdirSync,readFileSync,writeFileSync,chmodSync} from "node:fs";
import {join} from "node:path";
import {X509Certificate,randomBytes,createHash} from "node:crypto";
import {isIP} from "node:net";

function newCertificate(commonName:string,days:number){
 const keys=forge.pki.rsa.generateKeyPair({bits:3072,e:0x10001});
 const cert=forge.pki.createCertificate();
 cert.publicKey=keys.publicKey;
 cert.serialNumber=randomBytes(16).toString("hex").replace(/^0/,"1");
 cert.validity.notBefore=new Date(Date.now()-60_000);
 cert.validity.notAfter=new Date(Date.now()+days*86_400_000);
 cert.setSubject([{name:"commonName",value:commonName}]);
 return {keys,cert};
}
function save(path:string,value:string,mode:number){writeFileSync(path,value,{mode});chmodSync(path,mode)}
/** Generate local development CA and server certificate without invoking an external executable. */
export function ensureLocalTls(directory:string,namesText:string){
 const names=namesText.split(",").map(x=>x.trim()).filter(Boolean);
 if(!names.length||names.some(x=>!/^[a-zA-Z0-9.:-]+$/.test(x)))throw Error("Invalid TLS_SERVER_NAMES");
 mkdirSync(directory,{recursive:true,mode:0o700});
 const caKey=join(directory,"ca-key.pem"),caCert=join(directory,"ca.pem");
 const serverKey=join(directory,"server-key.pem"),serverCert=join(directory,"server.pem");
 if(!existsSync(caKey)||!existsSync(caCert)){
  const {keys,cert}=newCertificate("Virtual Inbox Local CA",365);
  cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([{name:"basicConstraints",cA:true,critical:true},{name:"keyUsage",keyCertSign:true,cRLSign:true,critical:true},{name:"subjectKeyIdentifier"}]);
  cert.sign(keys.privateKey,forge.md.sha256.create());
  save(caKey,forge.pki.privateKeyToPem(keys.privateKey),0o600);
  save(caCert,forge.pki.certificateToPem(cert),0o644);
 }
 const fingerprintFile=join(directory,"server-names.sha256");
 const namesHash=createHash("sha256").update([...new Set(names)].sort((a,b)=>a.localeCompare(b)).join(",")).digest("hex");
 const renew=!existsSync(serverKey)||!existsSync(serverCert)||!existsSync(fingerprintFile)||readFileSync(fingerprintFile,"utf8")!==namesHash||Date.parse(new X509Certificate(readFileSync(serverCert)).validTo)<Date.now()+7*86_400_000;
 if(renew){
  const ca=forge.pki.certificateFromPem(readFileSync(caCert,"utf8"));
  const caPrivate=forge.pki.privateKeyFromPem(readFileSync(caKey,"utf8"));
  const {keys,cert}=newCertificate(names[0],30);
  cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([
   {name:"basicConstraints",cA:false,critical:true},
   {name:"keyUsage",digitalSignature:true,keyEncipherment:true,critical:true},
   {name:"extKeyUsage",serverAuth:true},
   {name:"subjectAltName",altNames:names.map(value=>isIP(value)?{type:7,ip:value}:{type:2,value})}
  ]);
  cert.sign(caPrivate,forge.md.sha256.create());
  save(serverKey,forge.pki.privateKeyToPem(keys.privateKey),0o600);
  save(serverCert,forge.pki.certificateToPem(cert),0o644);
  save(fingerprintFile,namesHash,0o600);
 }
 return {cert:serverCert,key:serverKey,ca:caCert};
}
