import {randomUUID} from "node:crypto";
import type {Attachment} from "../core.js";

/** postal-mime v4 returns ArrayBuffer attachment bodies; normalize before quotas/storage. */
export function normalizeMimeAttachments(items:readonly {filename?:string|null;mimeType?:string|null;content:ArrayBuffer|ArrayBufferView}[]):Attachment[]{
 return items.map(item=>{
  const bytes=Buffer.from(item.content instanceof ArrayBuffer?item.content:Buffer.from(item.content.buffer,item.content.byteOffset,item.content.byteLength));
  return {id:randomUUID(),filename:item.filename||"attachment",contentType:item.mimeType||"application/octet-stream",size:bytes.byteLength,content:bytes};
 });
}
export function sanitizeDownloadName(name:string):string{
 return name.replace(/[\r\n]/g,"").replace(/[\\/]/g,"_");
}
