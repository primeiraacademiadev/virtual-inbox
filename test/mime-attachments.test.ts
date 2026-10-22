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
