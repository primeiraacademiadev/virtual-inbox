import test from "node:test";
import assert from "node:assert/strict";
import {normalizeMimeAttachments,sanitizeDownloadName} from "../src/mime/attachments.js";
test("postal-mime ArrayBuffer content retains exact length and bytes",()=>{
 const expected=Buffer.from("%PDF\r\nhello");
 const raw=expected.buffer.slice(expected.byteOffset,expected.byteOffset+expected.byteLength);
 const [attachment]=normalizeMimeAttachments([{filename:"report.pdf",mimeType:"application/pdf",content:raw}]);
 assert.equal(attachment.size,expected.length);
 assert.deepEqual(attachment.content,expected);
});
test("download sanitization preserves letters r and n",()=>{
 assert.equal(sanitizeDownloadName("report.pdf"),"report.pdf");
 assert.equal(sanitizeDownloadName("run-report.pdf"),"run-report.pdf");
 assert.equal(sanitizeDownloadName("r\neport.pdf"),"report.pdf");
 assert.equal(sanitizeDownloadName("foo/bar.pdf"),"foo_bar.pdf");
});

test("postal-mime Uint8Array content preserves a sliced byte view",()=>{
 const source=Uint8Array.from([0,82,78,10,255,0]);
 const view=source.subarray(1,5);
 const [attachment]=normalizeMimeAttachments([{filename:"run.bin",content:view}]);
 assert.equal(attachment.size,4);
 assert.deepEqual([...attachment.content],[82,78,10,255]);
});
test("postal-mime string content is decoded from base64",()=>{
 const expected=Buffer.from([0,255,82,110]);
 const [attachment]=normalizeMimeAttachments([{filename:"binary.bin",content:expected.toString("base64")}]);
 assert.equal(attachment.size,expected.byteLength);
 assert.deepEqual(attachment.content,expected);
});
