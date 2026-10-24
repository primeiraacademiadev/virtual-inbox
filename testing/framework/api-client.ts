import {apiUrl} from "./environment";
export type Inbox={id:string;address:string;channel:"email"|"sms"};
export type CapturedMessage={id:string;subject?:string;body:string;from:string;attachments?:Array<{id:string;filename:string;size:number}>};
export class ApiClient{
 readonly created:string[]=[];
 async fetch(path:string,init?:RequestInit){
  const response=await fetch(apiUrl+path,{...init,headers:{"content-type":"application/json",...init?.headers}});
  if(!response.ok)throw new Error(`API ${init?.method||"GET"} ${path}: ${response.status} ${await response.text()}`);
  return response;
 }
 async json<T>(path:string,init?:RequestInit):Promise<T>{return await (await this.fetch(path,init)).json() as T}
 async create(channel:"email"|"sms",generation?:Record<string,unknown>):Promise<Inbox>{
  const r=await this.json<Inbox>(channel==="email"?"/mailboxes":"/phone-numbers",{method:"POST",body:JSON.stringify({ttlSeconds:180,generation})});
  this.created.push((channel==="email"?"/mailboxes/":"/phone-numbers/")+r.id);
  return r;
 }
 async messages(inbox:Inbox){return this.json<CapturedMessage[]>((inbox.channel==="email"?"/mailboxes/":"/phone-numbers/")+inbox.id+"/messages")}
 async waitFor(inbox:Inbox,subject:string,timeoutMs=10000){
  const response=await this.fetch("/mailboxes/"+inbox.id+"/wait-for-message",{method:"POST",body:JSON.stringify({timeoutMs,match:{subjectContains:subject}})});
  return response.status===204?null:await response.json() as CapturedMessage;
 }
 async dispose(){for(const path of this.created.reverse()){try{await this.fetch(path,{method:"DELETE"})}catch{}}this.created.length=0}
}
