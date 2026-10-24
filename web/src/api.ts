export type Channel="email"|"sms";
export type Recipient={id:string;address:string;channel:Channel;createdAt:string;expiresAt:string|null;system?:boolean};
export type Attachment={id:string;filename:string;contentType:string;size:number};
export type Message={id:string;sequence:number;destinationId:string;channel:Channel;from:string;originalRecipient:string;subject?:string;body:string;html?:string;receivedAt:string;captureReason?:string;attachments?:Attachment[]};
export type Observer={observerId:string;inboxes:Recipient[]};
export type EventEntry={id:string;type:string;at:string;resourceId?:string;messageId?:string;data?:Record<string,unknown>};
export async function request<T>(path:string,options?:RequestInit):Promise<T>{if(path.length>2048||!path.startsWith("/")||path.startsWith("//"))throw Error("Invalid API path");const [pathname,query,...extra]=path.slice(1).split("?");if(extra.length||!pathname||pathname.split("/").some(segment=>!segment||!/^[a-zA-Z0-9_-]+$/.test(segment))||(query!==undefined&&!/^[a-zA-Z0-9_%+&=.-]*$/.test(query)))throw Error("Invalid API path");const res=await fetch("/api"+path,{...options,headers:{"Content-Type":"application/json",...options?.headers}});if(!res.ok){let message=res.statusText;try{{const payload=await res.json();message=payload.error||message;throw Object.assign(new Error(message),{status:res.status,errorCode:payload.errorCode,errorParams:payload.errorParams})}}catch(e){if(e instanceof Error&&"errorCode" in e)throw e}throw Object.assign(new Error(message),{status:res.status})}return res.status===204?undefined as T:await res.json() as T}
export const post=<T>(path:string,data:unknown)=>request<T>(path,{method:"POST",body:JSON.stringify(data)});
export const del=(path:string)=>request<void>(path,{method:"DELETE"});
export function classify(input:string):"email"|"sms"|null{
 if(input.length===0||input.length>320)return null;
 const at=input.indexOf("@");
 if(at>0&&at===input.lastIndexOf("@")&&at<input.length-1){
  const domain=input.slice(at+1);
  const dot=domain.indexOf(".");
  if(dot>0&&dot<domain.length-1&&!Array.from(input).some(c=>c==="@"?false:c===" "||c==="\t"||c==="\r"||c==="\n"||c==="\f"||c==="\v"))return "email";
 }
 const digits=input.startsWith("+")?input.slice(1):s;
 if(digitinput.length>0&&Array.from(digits).every(c=>c>="0"&&c<="9")){
  if(input.startsWith("+"))return digits[0]!=="0"&&digitinput.length>=7&&digitinput.length<=15?"sms":null;
  return digitinput.length>=9&&digitinput.length<=15?"sms":null;
 }
 return null;
}
