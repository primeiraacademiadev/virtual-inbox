import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

export type Channel = "email" | "sms";
export type Recipient = { id: string; channel: Channel; address: string; createdAt: string; expiresAt: string | null; system?: boolean };
export type Message = { id: string; sequence: number; channel: Channel; destinationId: string; from: string; originalRecipient: string; subject?: string; body: string; html?: string; rawMime?: string; receivedAt: string; captureReason?: string };
export type Event = { id: string; type: string; at: string; resourceId?: string; messageId?: string; data?: Record<string,unknown> };
export const classify = (s:string): Channel | null => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?"email":/^\+[1-9]\d{6,14}$/.test(s)?"sms":null;
export class Fault extends Error { constructor(public status:number,message:string){super(message)} }
export class Sandbox {
  readonly runId=randomUUID();
  readonly emitter=new EventEmitter();
  readonly resources=new Map<string,Recipient>();
  readonly messages=new Map<string,Message>();
  readonly observers=new Map<string,{id:string;expiresAt:number;inboxes:Set<string>}>();
  readonly events:Event[]=[];
  private seq=0;
  private msgSeq=0;
  private addressIds=new Map<string,string>();
  readonly defaults:Record<Channel,string>;
  constructor(readonly capacity=2000) {
    this.emitter.setMaxListeners(0);
    this.defaults={email:this.addSystem("email","anomalies@sandbox.test"),sms:this.addSystem("sms","+999000000000")};
  }
  private key(c:Channel,a:string){return c+":"+(c==="email"?a.toLowerCase():a)}
  private addSystem(channel:Channel,address:string){const id=randomUUID();this.resources.set(id,{id,channel,address,createdAt:new Date().toISOString(),expiresAt:null,system:true});this.addressIds.set(this.key(channel,address),id);return id}
  log(type:string,resourceId?:string,messageId?:string,data?:Record<string,unknown>){
    const id=this.runId+":"+(++this.seq);
    const e:Event={id,type,at:new Date().toISOString(),resourceId,messageId,data};
    this.events.push(e);if(this.events.length>this.capacity)this.events.shift();
    this.emitter.emit("event",e);return e;
  }
  resource(id:string){const r=this.resources.get(id);if(!r||r.expiresAt&&Date.parse(r.expiresAt)<=Date.now())throw new Fault(404,"Inbox not found");return r}
  list(channel?:Channel){return [...this.resources.values()].filter(r=>(!channel||r.channel===channel)&&(!r.expiresAt||Date.parse(r.expiresAt)>Date.now()))}
  find(channel:Channel,address:string){const id=this.addressIds.get(this.key(channel,address));return id?this.resource(id):undefined}
  create(channel:Channel,address?:string,ttlSeconds=1800,observerId?:string){
    if(!Number.isInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>604800)throw new Fault(400,"Invalid TTL");
    const addr=address?.trim()||(channel==="email"?"inbox-"+randomUUID().slice(0,10)+"@sandbox.test":"+999"+String(Math.floor(Math.random()*1e9)).padStart(9,"0"));
    if(classify(addr)!==channel)throw new Fault(400,"Invalid identifier");
    if(this.addressIds.has(this.key(channel,addr)))throw new Fault(409,"Identifier already exists");
    const o=observerId?this.observer(observerId):null;
    const r:Recipient={id:randomUUID(),channel,address:addr,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+ttlSeconds*1000).toISOString()};
    this.resources.set(r.id,r);this.addressIds.set(this.key(channel,addr),r.id);o?.inboxes.add(r.id);
    this.log("recipient.created",r.id,undefined,{channel,address:addr});return r;
  }
  deleteResource(id:string){
    const r=this.resource(id);if(r.system)throw new Fault(403,"System inbox cannot be deleted");
    this.resources.delete(id);this.addressIds.delete(this.key(r.channel,r.address));
    for(const m of this.messages.values())if(m.destinationId===id)this.messages.delete(m.id);
    for(const o of this.observers.values())o.inboxes.delete(id);
    this.emitter.emit("resource.removed",id);this.log("recipient.deleted",id);
  }
  deliver(channel:Channel,from:string,to:string,body:string,subject?:string,html?:string,rawMime?:string){
    if(!from||!to||typeof body!=="string")throw new Fault(400,"From, to and body required");
    if(body.length>262144||rawMime&&rawMime.length>1048576)throw new Fault(413,"Payload too large");
    const id=this.addressIds.get(this.key(channel,to));const r=id?this.resources.get(id):null;
    const reason=!r?"UNKNOWN_RECIPIENT":r.expiresAt&&Date.parse(r.expiresAt)<=Date.now()?"EXPIRED_RECIPIENT":undefined;
    const destinationId=reason?this.defaults[channel]:r!.id;
    const m:Message={id:randomUUID(),sequence:++this.msgSeq,channel,destinationId,from,originalRecipient:to,body,subject,html,rawMime,receivedAt:new Date().toISOString(),captureReason:reason};
    this.messages.set(m.id,m);
    this.log(reason?"message.captured":"message.received",destinationId,m.id,{reason});
    this.emitter.emit("message",m);return m;
  }
  listMessages(id:string){this.resource(id);return [...this.messages.values()].filter(m=>m.destinationId===id).sort((a,b)=>a.sequence-b.sequence)}
  removeMessage(id:string,messageId:string){this.resource(id);const m=this.messages.get(messageId);if(!m||m.destinationId!==id)throw new Fault(404,"Message not found");this.messages.delete(messageId);this.log("message.deleted",id,messageId)}
  clearMessages(id:string){for(const m of this.listMessages(id))this.removeMessage(id,m.id)}
  newObserver(){const id=randomUUID();this.observers.set(id,{id,expiresAt:Date.now()+3600000,inboxes:new Set()});return this.snapshot(id)}
  observer(id:string){const o=this.observers.get(id);if(!o||o.expiresAt<=Date.now())throw new Fault(404,"Observer not found");o.expiresAt=Date.now()+3600000;return o}
  snapshot(id:string){const o=this.observer(id);return {observerId:id,inboxes:[...o.inboxes].flatMap(i=>{try{return [this.resource(i)]}catch{return []}})}}
  watch(id:string,resourceId:string){const o=this.observer(id),r=this.resource(resourceId);o.inboxes.add(r.id);return {recipient:r,messages:this.listMessages(r.id)}}
  unwatch(id:string,resourceId:string){this.observer(id).inboxes.delete(resourceId)}
  replay(after?:string){let events=this.events,gap=false,reset=false;if(after){const [run,n]=after.split(":");if(run!==this.runId)reset=true;else{const seq=Number(n);gap=!!events.length&&seq<Number(events[0].id.split(":")[1])-1;events=events.filter(e=>Number(e.id.split(":")[1])>seq)}}return {events,gap,reset,runId:this.runId,oldest:this.events[0]?.id,latest:this.events.at(-1)?.id}}
  wait(id:string,{after=0,timeoutMs=10000,match={}}:{after?:number;timeoutMs?:number;match?:{from?:string;bodyContains?:string;subjectContains?:string}},signal?:AbortSignal):Promise<Message|null>{
    this.resource(id);
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new Fault(400,"Invalid timeout");
    const fits=(m:Message)=>m.destinationId===id&&m.sequence>after&&(!match.from||m.from===match.from)&&(!match.bodyContains||m.body.includes(match.bodyContains))&&(!match.subjectContains||(m.subject||"").includes(match.subjectContains));
    const found=this.listMessages(id).find(fits);if(found)return Promise.resolve(found);
    return new Promise(resolve=>{
      let done=false;
      const finish=(m:Message|null)=>{if(done)return;done=true;clearTimeout(timer);this.emitter.off("message",onMessage);this.emitter.off("resource.removed",onRemove);signal?.removeEventListener("abort",onAbort);resolve(m)};
      const onMessage=(m:Message)=>{if(fits(m))finish(m)};
      const onRemove=(removedId:string)=>{if(removedId===id)finish(null)};
      const onAbort=()=>finish(null);
      const timer=setTimeout(()=>finish(null),timeoutMs);
      this.emitter.on("message",onMessage);this.emitter.on("resource.removed",onRemove);signal?.addEventListener("abort",onAbort,{once:true});
      const raced=this.listMessages(id).find(fits);if(raced)finish(raced);
    });
  }
  cleanup(){for(const r of [...this.resources.values()])if(r.expiresAt&&Date.parse(r.expiresAt)<=Date.now()){this.resources.delete(r.id);this.addressIds.delete(this.key(r.channel,r.address));for(const m of this.messages.values())if(m.destinationId===r.id)this.messages.delete(m.id);for(const o of this.observers.values())o.inboxes.delete(r.id);this.emitter.emit("resource.removed",r.id);this.log("recipient.expired",r.id)}for(const [id,o] of this.observers)if(o.expiresAt<=Date.now())this.observers.delete(id)}
}
