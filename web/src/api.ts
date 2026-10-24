export type Channel="email"|"sms";
export type Recipient={id:string;address:string;channel:Channel;createdAt:string;expiresAt:string|null;system?:boolean};
export type Attachment={id:string;filename:string;contentType:string;size:number};
export type Message={id:string;sequence:number;destinationId:string;channel:Channel;from:string;originalRecipient:string;subject?:string;body:string;html?:string;receivedAt:string;captureReason?:string;attachments?:Attachment[]};
export type Observer={observerId:string;inboxes:Recipient[]};
export type EventEntry={id:string;type:string;at:string;resourceId?:string;messageId?:string;data?:Record<string,unknown>};
export async function request<T>(path:string,options?:RequestInit):Promise<T>{if(!/^\/(?:[a-zA-Z0-9_-]+\/?)*$/.test(path))throw Error("Invalid API path");const res=await fetch("/api"+path,{...options,headers:{"Content-Type":"application/json",...options?.headers}});if(!res.ok){let message=res.statusText;try{{const payload=await res.json();message=payload.error||message;throw Object.assign(new Error(message),{status:res.status,errorCode:payload.errorCode,errorParams:payload.errorParams})}}catch(e){if(e instanceof Error&&"errorCode" in e)throw e}throw Object.assign(new Error(message),{status:res.status})}return res.status===204?undefined as T:await res.json() as T}
export const post=<T>(path:string,data:unknown)=>request<T>(path,{method:"POST",body:JSON.stringify(data)});
export const del=(path:string)=>request<void>(path,{method:"DELETE"});
export function classify(input:string):Channel|null{return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)?"email":/^(?:\+[1-9]\d{6,14}|\d{9,15})$/.test(input)?"sms":null}
