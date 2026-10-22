import {randomUUID} from "node:crypto";
export const positive=(key:string,fallback:number)=>{const value=Number(process.env[key]??fallback);if(!Number.isSafeInteger(value)||value<=0)throw Error("Invalid "+key);return value};
export const config={
smtpBytes:positive("MAX_SMTP_MESSAGE_BYTES",20*1024*1024),
attachmentBytes:positive("MAX_ATTACHMENT_BYTES",20*1024*1024),
httpBytes:positive("MAX_HTTP_BODY_BYTES",32*1024*1024),
smsBytes:positive("MAX_SMS_BODY_BYTES",64*1024),
bodyChars:positive("MAX_MESSAGE_BODY_CHARS",2*1024*1024),
messages:positive("MAX_MESSAGE_COUNT",10000),
storedBytes:positive("MAX_STORED_BYTES",256*1024*1024),
logs:positive("MAX_LOG_ENTRIES",2000),
defaultTtl:positive("DEFAULT_INBOX_TTL_SECONDS",1800),
maxTtl:positive("MAX_INBOX_TTL_SECONDS",604800),
observerTtl:positive("OBSERVER_SESSION_TTL_SECONDS",3600),
waitMs:positive("MAX_WAIT_TIMEOUT_MS",120000),
maxConnections:positive("MAX_CONNECTIONS",200),
maxInboxes:positive("MAX_INBOX_COUNT",2000),
maxObservers:positive("MAX_OBSERVER_COUNT",500),
maxAttachments:positive("MAX_ATTACHMENTS_PER_MESSAGE",20),
};
export function getSize(bytes:Buffer|string){return Buffer.isBuffer(bytes)?bytes.length:Buffer.byteLength(bytes)}
export function token(){return randomUUID()}
