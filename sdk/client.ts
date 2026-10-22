/** HTTP-only client. Runs in Node.js 24+ (native fetch). */
export type Channel="email"|"sms";
export type Inbox={id:string;channel:Channel;address:string;createdAt:string;expiresAt:string|null};
export type AttachmentInfo={id:string;filename:string;contentType:string;size:number};
export type InboxMessage={id:string;sequence:number;channel:Channel;destinationId:string;from:string;originalRecipient:string;subject?:string;body:string;attachments?:AttachmentInfo[]};
export class VirtualInboxClient {
 constructor(readonly baseUrl="http://127.0.0.1:3000"){}
 private async request<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(new URL(path,this.baseUrl),{...init,headers:{"content-type":"application/json",...init?.headers}});if(res.status===204)return null as T;if(!res.ok)throw Error("Virtual Inbox HTTP "+res.status+": "+await res.text());return await res.json() as T}
 create(channel:Channel,address?:string,ttlSeconds=1800):Promise<Inbox>{return this.request(channel==="email"?"/mailboxes":"/phone-numbers",{method:"POST",body:JSON.stringify({[channel==="email"?"address":"phoneNumber"]:address,ttlSeconds})})}
 messages(inbox:Inbox):Promise<InboxMessage[]>{return this.request(`${inbox.channel==="email"?"/mailboxes":"/phone-numbers"}/${inbox.id}/messages`)}
 wait(inbox:Inbox,match:{from?:string;subjectContains?:string;bodyContains?:string},timeoutMs=10000,after=0):Promise<InboxMessage|null>{return this.request(`${inbox.channel==="email"?"/mailboxes":"/phone-numbers"}/${inbox.id}/wait-for-message`,{method:"POST",body:JSON.stringify({match,timeoutMs,after})})}
 async download(inbox:Inbox,messageId:string,attachmentId:string):Promise<Uint8Array>{const url=`${inbox.channel==="email"?"/mailboxes":"/phone-numbers"}/${inbox.id}/messages/${messageId}/attachments/${attachmentId}`;const response=await fetch(new URL(url,this.baseUrl));if(!response.ok)throw Error("Download failed: "+response.status);return new Uint8Array(await response.arrayBuffer())}
 delete(inbox:Inbox):Promise<void>{return this.request(`${inbox.channel==="email"?"/mailboxes":"/phone-numbers"}/${inbox.id}`,{method:"DELETE"})}
 async withInbox<T>(channel:Channel,fn:(inbox:Inbox)=>Promise<T>,address?:string,ttlSeconds=1800):Promise<T>{const inbox=await this.create(channel,address,ttlSeconds);try{return await fn(inbox)}finally{await this.delete(inbox)}}
}
